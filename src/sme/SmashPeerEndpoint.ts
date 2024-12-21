import { SmashPeer } from '@src/SmashPeer.js';
import { SignalSession } from '@src/signal/index.js';
import {
    EncapsulatedIMProtoMessage,
    SmashEndpoint,
    sha256,
} from '@src/types/index.js';
import AsyncLock from 'async-lock';

const QUEUE_MUTEX_NAME = 'queue';

// TODO should this class be merged 1:1 with SignalSession?
export class SmashPeerEndpoint {
    private readonly messageQueue: Map<sha256, EncapsulatedIMProtoMessage> =
        new Map();

    constructor(
        private readonly peer: SmashPeer,
        public readonly endpointConfig: SmashEndpoint,
        historicalMessageQueue: Map<sha256, EncapsulatedIMProtoMessage>,
    ) {
        this.messageQueue = new Map([...historicalMessageQueue]);
    }

    private readonly mutex = new AsyncLock();

    queue(message: EncapsulatedIMProtoMessage): Promise<void> {
        return this.mutex.acquire(QUEUE_MUTEX_NAME, () => {
            this.queueBypassingMutex(message);
        });
    }

    private queueBypassingMutex(message: EncapsulatedIMProtoMessage) {
        this.messageQueue.set(message.sha256, message);
        this.peer.logger.debug(
            `> queued message ${message.sha256} for ${this.endpointConfig.url} (${this.messageQueue.size})`,
        );
    }

    async ack(messageIds: sha256[]) {
        return this.mutex.acquire(QUEUE_MUTEX_NAME, () => {
            messageIds.forEach((messageId) => {
                this.messageQueue.delete(messageId);
                this.peer.logger.debug(
                    `> acknowledged message ${messageId} for ${this.endpointConfig.url} (${this.messageQueue.size})`,
                );
            });
        });
    }

    /**
     * Flushes the message queue to the endpoint.
     * If the session is expired, it will be re-initialized.
     * @throws Error if message isnt delivered within 3 seconds.
     */
    async flush(shouldUseSession: SignalSession | undefined): Promise<void> {
        const session = shouldUseSession ?? (await this.thisSession());
        return this.mutex.acquire(QUEUE_MUTEX_NAME, async () => {
            await this.init(session);
            if (!this.messageQueue.size) {
                this.peer.logger.debug(
                    `> no undelivered messages to flush for ${this.endpointConfig.url}`,
                );
                return;
            }
            const undeliveredMessages = Array.from(this.messageQueue.values());
            this.peer.logger.debug(
                `> flushing ${undeliveredMessages.length} messages to ${this.endpointConfig.url}`,
            );
            const socket = this.peer.smeSocketManager.getOrCreate(
                this.endpointConfig.url,
            );
            try {
                await socket.sendData(
                    this.endpointConfig.preKey,
                    session.id,
                    await session.encryptMessages(undeliveredMessages),
                    undeliveredMessages.map((m) => m.sha256),
                );
                this.messageQueue.clear();
                this.peer.logger.debug(
                    `> flushed ${undeliveredMessages.length} messages to ${this.endpointConfig.url} (cleared queue)`,
                );
            } catch (error) {
                this.peer.logger.error(
                    `> failed to flush messages to ${this.endpointConfig.url}: ${(error as Error).message}`,
                );
                this.peer.logger.info(
                    `> resetting session: ${this.session?.id}`,
                );
                // TODO: is reset session really needed everytime here?
                this.session = undefined;
                throw error;
            }
        });
    }

    private async init(session: SignalSession): Promise<void> {
        if (session.firstUse) {
            this.peer.logger.debug(
                `> initializing first use session ${session.id}`,
            );
            await Promise.allSettled([
                this.peer.getEncapsulatedProfileMessage().then((message) => {
                    this.peer.logger.debug(
                        `> queueing profile message for ${this.endpointConfig.url}`,
                    );
                    this.queueBypassingMutex(message);
                }),
                (async () => {
                    const msg =
                        this.peer.smeSocketManager.getPreferredEndpointMessage();
                    this.peer.logger.debug(
                        `> queueing preferred endpoint message for ${this.endpointConfig.url}`,
                    );
                    this.queueBypassingMutex(msg);
                })(),
            ]);
            session.firstUse = false;
        }
    }

    private session?: SignalSession;
    private async thisSession(): Promise<SignalSession> {
        if (!this.session || this.session.isExpired()) {
            const session = await this.peer.sessionManager.initSession(
                await this.peer.getDID(),
                this.endpointConfig,
            );
            this.session = session;
        }
        return this.session;
    }

    resetSession() {
        this.session = undefined;
    }
}
