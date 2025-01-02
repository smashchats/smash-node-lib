import { SmashPeer } from '@src/SmashPeer.js';
import { SessionManager, SignalSession } from '@src/signal/index.js';
import { SMESocketManager } from '@src/sme/SMESocketManager.js';
import {
    EncapsulatedIMProtoMessage,
    SmashEndpoint,
    sha256,
} from '@src/types/index.js';
import { Logger } from '@src/utils/Logger.js';
import AsyncLock from 'async-lock';

const QUEUE_MUTEX_NAME = 'queue';

// TODO should this class be merged 1:1 with SignalSession?
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

    queue(message: EncapsulatedIMProtoMessage): Promise<void> {
        return this.mutex.acquire(QUEUE_MUTEX_NAME, () => {
            this.queueBypassingMutex(message);
        });
    }

    private queueBypassingMutex(message: EncapsulatedIMProtoMessage) {
        this.messageQueue.set(message.sha256, message);
        this.logger.debug(
            `> queued ${message.sha256} for ${this.config.url} (${this.messageQueue.size})`,
        );
    }

    async ack(messageIds: sha256[]) {
        return this.mutex.acquire(QUEUE_MUTEX_NAME, () => {
            messageIds.forEach((messageId) => {
                this.messageQueue.delete(messageId);
                this.logger.debug(
                    `> acknowledged message ${messageId} for ${this.config.url} (${this.messageQueue.size})`,
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

    resetSession() {
        this.session = undefined;
    }
}
