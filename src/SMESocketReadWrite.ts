import { Identity } from '2key-ratchet';
import CryptoUtils from '@src/CryptoUtils.js';
import { Logger } from '@src/Logger.js';
import {
    SMESocketWriteOnly,
    onMessagesStatusFn,
} from '@src/SMESocketWriteOnly.js';
import { SessionManager } from '@src/SessionManager.js';
import { SignalSession } from '@src/SignalSession.js';
import {
    EncapsulatedSmashMessage,
    SMEConfig,
    SmashEndpoint,
} from '@src/types/index.js';
import { Socket } from 'socket.io-client';

const solveChallenge = async (
    data: { iv: string; challenge: string },
    auth: SMEConfig,
    socket: Socket,
    logger: Logger,
) => {
    try {
        const ivBuffer = CryptoUtils.singleton.stringToBuffer(
            data.iv,
            auth.challengeEncoding,
        );
        const challengeBuffer = CryptoUtils.singleton.stringToBuffer(
            data.challenge,
            auth.challengeEncoding,
        );
        const smePublicKey = await CryptoUtils.singleton.importKey(
            auth.smePublicKey,
            auth.keyAlgorithm,
        );

        const symmetricKey = await CryptoUtils.singleton.deriveKey(
            {
                ...auth.keyAlgorithm,
                public: smePublicKey,
            } as KeyAlgorithm,
            auth.preKeyPair.privateKey,
            auth.encryptionAlgorithm,
            false,
            ['encrypt', 'decrypt'],
        );

        const unencryptedChallenge = await CryptoUtils.singleton.decrypt(
            {
                ...auth.encryptionAlgorithm,
                iv: ivBuffer,
            } as KeyAlgorithm,
            symmetricKey,
            challengeBuffer,
        );

        const solvedChallenge = CryptoUtils.singleton.bufferToString(
            unencryptedChallenge,
            auth.challengeEncoding,
        );

        logger.debug(
            `> SME Challenge (${data.challenge}) -> (${solvedChallenge})`,
        );
        socket.emit('register', solvedChallenge);
    } catch (err) {
        logger.warn(
            'Cannot solve challenge.',
            err instanceof Error ? err.message : err,
        );
        throw err;
    }
};

export type onMessagesFn = (
    peerIk: string,
    messages: EncapsulatedSmashMessage[],
) => void;

export class SMESocketReadWrite extends SMESocketWriteOnly {
    // TODO: limit DLQs size and number
    private dlq: Record<string, ArrayBuffer[]> = {};

    constructor(
        url: string,
        private sessionManager: SessionManager,
        private onMessagesCallback: onMessagesFn,
        onMessagesStatusCallback: onMessagesStatusFn,
        logger: Logger,
    ) {
        super(url, onMessagesStatusCallback, logger);
    }

    public async initSocketWithAuth(
        identity: Identity,
        auth: SMEConfig,
    ): Promise<SmashEndpoint> {
        this.logger.debug('SMESocketReadWrite::initSocketWithAuth');
        try {
            const preKey = await CryptoUtils.singleton.exportKey(
                auth.preKeyPair.publicKey.key,
            );
            const signature = await CryptoUtils.singleton.signAsString(
                identity.signingKey.privateKey,
                auth.preKeyPair.publicKey.serialize(),
            );
            this.socket = SMESocketWriteOnly.initSocket(this.logger, auth.url, {
                key: preKey,
                keyAlgorithm: auth.keyAlgorithm,
            });
            this.logger.debug('auth:= ', JSON.stringify(auth, null, 2));
            this.socket.on('challenge', async (data) => {
                this.logger.debug(
                    'SMESocketReadWrite::challenge',
                    this.socket?.id,
                );
                this.logger.debug('auth:= ', JSON.stringify(auth, null, 2));
                this.logger.debug('data:= ', JSON.stringify(data, null, 2));
                await solveChallenge(data, auth, this.socket!, this.logger);
            });
            this.socket.on('data', this.processMessages.bind(this));
            return {
                url: auth.url,
                preKey,
                signature,
            };
        } catch (err) {
            this.logger.error('Cannot init socket with auth.');
            throw err;
        }
    }

    private async processMessages(sessionId: string, data: ArrayBuffer) {
        this.logger.debug(
            `SMESocketReadWrite::processMessages for ${sessionId}`,
        );
        const session = this.sessionManager.getSessionById(sessionId);
        if (session) {
            this.logger.info(`Incoming data for session ${sessionId}`);
            this.emitReceivedMessages(
                await session.decryptData(data),
                session.peerIk,
            );
        } else {
            await this.attemptNewSession(sessionId, data);
        }
    }

    private async attemptNewSession(sessionId: string, data: ArrayBuffer) {
        try {
            const [parsedSession, firstMessages] =
                await this.sessionManager.parseSession(sessionId, data);
            this.logger.info(`New session ${sessionId}`);
            this.emitReceivedMessages(firstMessages, parsedSession.peerIk);
            await this.processQueuedMessages(parsedSession);
        } catch (err) {
            if (
                err instanceof Error &&
                err.message.startsWith(
                    'Cannot decode message for PreKeyMessage.',
                )
            ) {
                this.logger.info(
                    `Queuing data for session ${sessionId} (${err.message})`,
                );
                this.addToDlq(sessionId, data);
            } else {
                this.logger.warn(`Unprocessable data for ${sessionId}`);
                throw err;
            }
        }
    }

    private async processQueuedMessages(session: SignalSession) {
        this.logger.debug(
            `processQueuedMessages for ${session.id} (${this.dlq[session.id]?.length})`,
        );
        if (this.dlq[session.id]?.length) {
            try {
                const decryptedMessages = await Promise.all(
                    this.dlq[session.id].map((message) =>
                        session.decryptData(message),
                    ),
                );
                delete this.dlq[session.id];
                this.logger.debug(
                    `> Cleared DLQ (${this.dlq[session.id]?.length})`,
                );
                this.logger.debug(`>> streams:= ${decryptedMessages.length}`);
                for (const stream of decryptedMessages) {
                    this.logger.debug(`>>> messages:= ${stream.length}`);
                }
                this.emitReceivedMessages(
                    decryptedMessages.flat(),
                    session.peerIk,
                );
            } catch {
                this.logger.warn(
                    `Cannot process queued messages for ${session.id}`,
                );
            }
        }
    }

    private addToDlq(sessionId: string, data: ArrayBuffer) {
        if (!this.dlq[sessionId]) {
            this.dlq[sessionId] = [];
        }
        this.dlq[sessionId].push(data);
        this.logger.debug(
            `> Added message(s) to DLQ (${this.dlq[sessionId].length})`,
        );
    }

    private emitReceivedMessages(
        messages: EncapsulatedSmashMessage[],
        peerIk: string,
    ) {
        this.logger.debug('SMESocketReadWrite::emitReceivedMessages');
        this.onMessagesCallback(peerIk, messages);
    }
}
