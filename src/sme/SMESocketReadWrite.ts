import { SessionManager, SignalSession } from '@src/signal/index.js';
import { SMESocketWriteOnly } from '@src/sme/SMESocketWriteOnly.js';
import {
    EncapsulatedIMProtoMessage,
    Identity,
    SMEConfig,
    SmashEndpoint,
    onMessagesFn,
    onMessagesStatusFn,
} from '@src/types/index.js';
import { CryptoUtils, Logger } from '@src/utils/index.js';

export class SMESocketReadWrite extends SMESocketWriteOnly {
    // TODO: limit DLQs size and number
    private readonly dlq: Record<string, ArrayBuffer[]> = {};

    constructor(
        url: string,
        private readonly sessionManager: SessionManager,
        private readonly onMessagesCallback: onMessagesFn,
        onMessagesStatusCallback: onMessagesStatusFn,
        logger: Logger,
    ) {
        super(url, onMessagesStatusCallback, logger);
    }

    // TODO refactor
    public async initSocketWithAuth(
        identity: Identity,
        auth: SMEConfig,
    ): Promise<SmashEndpoint> {
        this.logger.debug('SMESocketReadWrite::initSocketWithAuth');
        return new Promise<SmashEndpoint>((resolve, reject) => {
            Promise.all([
                CryptoUtils.singleton.exportKey(auth.preKeyPair.publicKey.key),
                CryptoUtils.singleton.signAsString(
                    identity.signingKey.privateKey,
                    auth.preKeyPair.publicKey.serialize(),
                ),
            ]).then(([preKey, signature]) => {
                // we initialize a new socket with given auth params
                this.initSocket({
                    key: preKey,
                    keyAlgorithm: auth.keyAlgorithm,
                });
                if (!this.socket) {
                    this.logger.error('> SME socket not initialized');
                    throw new Error('> SME socket not initialized');
                }
                // TODO timeout
                this.socket.on('challenge', async (data) => {
                    this.logger.debug('SMESocketReadWrite::challenge');
                    try {
                        const solvedChallenge =
                            await CryptoUtils.singleton.solveChallenge(
                                data,
                                auth,
                            );

                        this.logger.debug(`> SME Challenge IV (${data.iv})`);
                        this.logger.debug(
                            `> SME Challenge (${data.challenge}) -> (${solvedChallenge})`,
                        );
                        if (
                            !this.socket ||
                            this.socket.disconnected ||
                            !this.socket.connected
                        ) {
                            this.logger.error('> SME socket not connected');
                            throw new Error('> SME socket not connected');
                        }
                        this.socket.emit('register', solvedChallenge, () => {
                            this.logger.debug('> SME Challenge SOLVED');
                            resolve({
                                url: auth.url,
                                preKey,
                                signature,
                            });
                        });
                    } catch (err) {
                        this.logger.error(
                            'Cannot solve challenge.',
                            err instanceof Error ? err.message : err,
                        );
                        reject(err);
                    }
                });
                this.socket.on('data', this.processMessages.bind(this));
            });
        });
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
        messages: EncapsulatedIMProtoMessage[],
        peerIk: string,
    ) {
        this.logger.debug('SMESocketReadWrite::emitReceivedMessages');
        this.onMessagesCallback(peerIk, messages);
    }
}
