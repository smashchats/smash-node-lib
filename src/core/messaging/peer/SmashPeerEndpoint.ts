import type { SmashPeer } from '@src/core/messaging/peer/SmashPeer.js';
import type { SessionManager } from '@src/core/messaging/session/SessionManager.js';
import type { SignalSession } from '@src/core/messaging/session/SignalSession.js';
import type { SMESocketManager } from '@src/infrastructure/network/sme/SMESocketManager.js';
import type { EncapsulatedIMProtoMessage } from '@src/shared/types/message.types.js';
import type { SmashEndpoint } from '@src/shared/types/sme.types.js';
import type { sha256 } from '@src/shared/types/string.types.js';
import type { Logger } from '@src/shared/utils/Logger.js';
import AsyncLock from 'async-lock';

const QUEUE_MUTEX_NAME = 'queue';

export class SmashPeerEndpoint {
    private readonly messageQueue: Map<sha256, EncapsulatedIMProtoMessage> =
        new Map();

    constructor(
        private readonly logger: Logger,
        private readonly peer: SmashPeer,
        private readonly smeSocketManager: SMESocketManager,
        private readonly sessionManager: SessionManager,
        public readonly config: SmashEndpoint,
        historicalMessageQueue: Map<sha256, EncapsulatedIMProtoMessage>,
    ) {
        this.messageQueue = new Map([...historicalMessageQueue]);
    }

    private readonly mutex = new AsyncLock();

    public queue(message: EncapsulatedIMProtoMessage): Promise<void> {
        return this.mutex.acquire(QUEUE_MUTEX_NAME, () => {
            this.queueBypassingMutex(message);
        });
    }

    public clearQueue(): Promise<void> {
        return this.mutex.acquire(QUEUE_MUTEX_NAME, () => {
            this.messageQueue.clear();
        });
    }

    private queueBypassingMutex(message: EncapsulatedIMProtoMessage) {
        this.messageQueue.set(message.sha256, message);
        this.logger.debug(
            `> queued ${message.sha256} for ${this.config.url} (${this.messageQueue.size})`,
        );
    }

    public async ack(messageIds: sha256[]) {
        return this.mutex.acquire(QUEUE_MUTEX_NAME, () => {
            messageIds.forEach((messageId) => {
                this.messageQueue.delete(messageId);
                this.logger.debug(
                    `> acknowledged message ${messageId} for ${this.config.url} (${this.messageQueue.size})`,
                );
            });
        });
    }

    public async waitForQueue(): Promise<void> {
        this.logger.debug(
            `> waiting to acquire queue mutex for ${this.config.url} ...`,
        );
        await this.mutex.acquire(
            QUEUE_MUTEX_NAME,
            () => {
                this.logger.debug(
                    `> ... acquired queue mutex for ${this.config.url}`,
                );
            },
            {
                skipQueue: true,
            },
        );
    }

    /**
     * Flushes the message queue to the endpoint.
     * If the session is expired, it will be re-initialized.
     * @throws Error if message isnt delivered within 3 seconds.
     */
    public async flush(
        shouldUseSession: SignalSession | undefined,
    ): Promise<void> {
        const session = shouldUseSession ?? (await this.thisSession());
        this.logger.debug(
            `> waiting to acquire flushing mutex for ${this.config.url} ...`,
        );
        return this.mutex.acquire(QUEUE_MUTEX_NAME, async () => {
            this.logger.debug(
                `> ... acquired flushing mutex for ${this.config.url}`,
            );
            await this.init(session);
            if (!this.messageQueue.size) {
                this.logger.debug(
                    `> no undelivered messages to flush for ${this.config.url}`,
                );
                return;
            }
            const undeliveredMessages = Array.from(this.messageQueue.values());
            this.logger.debug(
                `> flushing ${undeliveredMessages.length} messages to ${this.config.url}`,
            );
            const socket = this.smeSocketManager.getOrCreate(this.config.url);
            try {
                await socket.sendData(
                    this.config.preKey,
                    session.id,
                    await session.encryptMessages(undeliveredMessages),
                    undeliveredMessages.map((m) => m.sha256),
                );
                this.messageQueue.clear();
                this.logger.debug(
                    `> flushed ${undeliveredMessages.length} messages to ${this.config.url} (cleared queue)`,
                );
            } catch (error) {
                this.logger.error(
                    `> failed to flush messages to ${this.config.url}: ${(error as Error).message}`,
                );
                this.logger.info(`> resetting session: ${this.session?.id}`);
                // TODO: is reset session really needed everytime here?
                this.session = undefined;
                throw error;
            }
        });
    }

    private async init(session: SignalSession): Promise<void> {
        if (session.firstUse) {
            this.logger.debug(`> initializing first use session ${session.id}`);
            const newSessionProtocolMessages = [];
            try {
                newSessionProtocolMessages.push(
                    this.smeSocketManager.getPreferredEndpointMessage(),
                );
            } catch (error) {
                this.logger.debug(
                    `> skipping preferred endpoint message: ${(error as Error).message}`,
                );
            }
            newSessionProtocolMessages.push(
                await this.sessionManager.getDIDMessage(),
            );
            for (const message of newSessionProtocolMessages) {
                this.logger.debug(
                    `> queueing ${message.type} session message for ${this.config.url}`,
                );
                this.queueBypassingMutex(message);
            }
            session.firstUse = false;
        }
    }

    private session?: SignalSession;
    private async thisSession(): Promise<SignalSession> {
        if (!this.session || this.session.isExpired()) {
            this.session = await this.sessionManager.initSession(
                await this.peer.getDIDDocument(),
                this.config,
            );
        }
        return this.session;
    }

    public resetSession() {
        this.session = undefined;
    }
}
