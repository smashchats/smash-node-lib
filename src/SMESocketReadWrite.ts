import { Identity } from '2key-ratchet';
import CryptoUtils from '@src/CryptoUtils.js';
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
) => {
    const ivBuffer = Buffer.from(data.iv, auth.challengeEncoding);
    const challengeBuffer = Buffer.from(data.challenge, auth.challengeEncoding);

    const smePublicKey = await CryptoUtils.singleton.importKey(
        auth.smePublicKey,
        auth.keyAlgorithm,
    );

    const symmetricKey = await CryptoUtils.singleton.deriveKey(
        { ...auth.keyAlgorithm, public: smePublicKey } as KeyAlgorithm,
        auth.preKeyPair.privateKey,
        auth.encryptionAlgorithm,
        false,
        ['encrypt', 'decrypt'],
    );

    const unencryptedChallenge = await CryptoUtils.singleton.decrypt(
        { ...auth.encryptionAlgorithm, iv: ivBuffer } as KeyAlgorithm,
        symmetricKey,
        challengeBuffer,
    );

    const solvedChallenge = Buffer.from(unencryptedChallenge).toString(
        auth.challengeEncoding,
    );
    console.log(`> SME Challenge (${data.challenge}) -> (${solvedChallenge})`);
    socket.emit('register', solvedChallenge);
};

export type onMessagesFn = (
    messages: EncapsulatedSmashMessage[],
    peerIk: string,
) => any;

export class SMESocketReadWrite extends SMESocketWriteOnly {
    // TODO: limit DLQs size and number
    private dlq: Record<string, ArrayBuffer[]> = {};

    constructor(
        url: string,
        private sessionManager: SessionManager,
        private onMessagesCallback: onMessagesFn,
        onMessagesStatusCallback: onMessagesStatusFn,
    ) {
        super(url, onMessagesStatusCallback);
    }

    public async initSocketWithAuth(
        identity: Identity,
        auth: SMEConfig,
    ): Promise<SmashEndpoint> {
        const preKey = await CryptoUtils.singleton.exportKey(
            auth.preKeyPair.publicKey.key,
        );
        const signature = await CryptoUtils.singleton.signAsString(
            identity.signingKey.privateKey,
            auth.preKeyPair.publicKey.serialize(),
        );
        this.socket = SMESocketWriteOnly.initSocket(auth.url, {
            key: preKey,
            keyAlgorithm: auth.keyAlgorithm,
        });
        this.socket.on('challenge', (data) =>
            solveChallenge(data, auth, this.socket!),
        );
        // TODO: rename SME event to 'data' (or otherwise) to avoid confusion
        this.socket.on('data', this.processMessages.bind(this));
        return {
            url: auth.url,
            preKey,
            signature,
        };
    }

    private async processMessages(sessionId: string, data: ArrayBuffer) {
        console.debug(`SMESocketReadWrite::processMessages for ${sessionId}`);
        const session = this.sessionManager.getSessionById(sessionId);
        if (session) {
            console.log(`> Incoming data for session ${sessionId}`);
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
            console.log(`> New session ${sessionId}`);
            this.emitReceivedMessages(firstMessages, parsedSession.peerIk);
            await this.processQueuedMessages(parsedSession);
        } catch (err) {
            if (
                err instanceof Error &&
                err.message.startsWith(
                    'Cannot decode message for PreKeyMessage.',
                )
            ) {
                console.log(
                    `> Queuing data for session ${sessionId} (${err.message})`,
                );
                this.addToDlq(sessionId, data);
            } else {
                throw err;
            }
        }
    }

    private async processQueuedMessages(session: SignalSession) {
        console.debug(
            `processQueuedMessages for ${session.id} (${this.dlq[session.id]?.length})`,
        );
        if (this.dlq[session.id]) {
            const decryptedMessages = await Promise.all(
                this.dlq[session.id].map((message) =>
                    session.decryptData(message),
                ),
            );
            delete this.dlq[session.id];
            console.debug(`> Cleared DLQ (${this.dlq[session.id]?.length})`);
            console.debug(`>> streams:= ${decryptedMessages.length}`);
            for (const stream of decryptedMessages) {
                console.debug(`>>> messages:= ${stream.length}`);
            }
            this.emitReceivedMessages(decryptedMessages.flat(), session.peerIk);
        }
    }

    private addToDlq(sessionId: string, data: ArrayBuffer) {
        if (!this.dlq[sessionId]) {
            this.dlq[sessionId] = [];
        }
        this.dlq[sessionId].push(data);
        console.debug(
            `> Added message(s) to DLQ (${this.dlq[sessionId].length})`,
        );
    }

    private emitReceivedMessages(
        messages: EncapsulatedSmashMessage[],
        peerIk: string,
    ) {
        console.debug('SMESocketReadWrite::emitReceivedMessages');
        this.onMessagesCallback(messages, peerIk);
    }
}
