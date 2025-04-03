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
    private readonly mutex = new AsyncLock();
    private readonly messageQueue: Map<sha256, EncapsulatedIMProtoMessage>;
    private session?: SignalSession;

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

    public async queue(message: EncapsulatedIMProtoMessage): Promise<void> {
        await this.mutex.acquire(QUEUE_MUTEX_NAME, () => {
            this.addMessageToQueue(message);
        });
    }

    public async clearQueue(): Promise<void> {
        await this.mutex.acquire(QUEUE_MUTEX_NAME, () => {
            this.messageQueue.clear();
        });
    }

    public async ack(messageIds: sha256[]): Promise<void> {
        await this.mutex.acquire(QUEUE_MUTEX_NAME, () => {
            this.removeMessagesFromQueue(messageIds);
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
            { skipQueue: true },
        );
    }

    public async flush(providedSession?: SignalSession): Promise<void> {
        const session = providedSession ?? (await this.getOrCreateSession());

        await this.mutex.acquire(QUEUE_MUTEX_NAME, async () => {
            this.logger.debug(
                `> ... acquired flushing mutex for ${this.config.url}`,
            );

            await this.initializeSessionIfNeeded(session);

            if (this.messageQueue.size === 0) {
                this.logger.debug(
                    `> no undelivered messages to flush for ${this.config.url}`,
                );
                return;
            }

            await this.flushMessages(session);
        });
    }

    public resetSession(): void {
        this.session = undefined;
    }

    private addMessageToQueue(message: EncapsulatedIMProtoMessage): void {
        this.messageQueue.set(message.sha256, message);
        this.logger.debug(
            `> queued ${message.sha256} for ${this.config.url} (${this.messageQueue.size})`,
        );
    }

    private removeMessagesFromQueue(messageIds: sha256[]): void {
        messageIds.forEach((messageId) => {
            this.messageQueue.delete(messageId);
            this.logger.debug(
                `> acknowledged message ${messageId} for ${this.config.url} (${this.messageQueue.size})`,
            );
        });
    }

    private async getOrCreateSession(): Promise<SignalSession> {
        if (!this.session || this.session.isExpired()) {
            this.session = await this.sessionManager.initSession(
                await this.peer.getDIDDocument(),
                this.config,
            );
        }
        return this.session;
    }

    private async initializeSessionIfNeeded(
        session: SignalSession,
    ): Promise<void> {
        if (!session.firstUse) return;

        this.logger.debug(`> initializing first use session ${session.id}`);
        const protocolMessages = await this.getInitialProtocolMessages();

        protocolMessages.forEach((message) => {
            this.logger.debug(
                `> queueing ${message.type} session message for ${this.config.url}`,
            );
            this.addMessageToQueue(message);
        });

        session.firstUse = false;
    }

    private async getInitialProtocolMessages(): Promise<
        EncapsulatedIMProtoMessage[]
    > {
        const messages: EncapsulatedIMProtoMessage[] = [];

        try {
            messages.push(this.smeSocketManager.getPreferredEndpointMessage());
        } catch (error) {
            this.logger.debug(
                `> skipping preferred endpoint message: ${(error as Error).message}`,
            );
        }

        messages.push(await this.sessionManager.getDIDMessage());
        return messages;
    }

    private async flushMessages(session: SignalSession): Promise<void> {
        const messages = Array.from(this.messageQueue.values());
        this.logger.debug(
            `> flushing ${messages.length} messages to ${this.config.url}`,
        );

        try {
            await this.sendMessages(session, messages);
            this.messageQueue.clear();
            this.logger.debug(
                `> flushed ${messages.length} messages to ${this.config.url} (cleared queue)`,
            );
            this.logger.debug(messages);
        } catch (error) {
            await this.handleFlushError(error as Error);
        }
    }

    private async sendMessages(
        session: SignalSession,
        messages: EncapsulatedIMProtoMessage[],
    ): Promise<void> {
        const socket = this.smeSocketManager.getOrCreate(this.config.url);
        await socket.sendData(
            this.config.preKey,
            session.id,
            await session.encryptMessages(messages),
            messages.map((m) => m.sha256),
        );
    }

    private async handleFlushError(error: Error): Promise<void> {
        this.logger.error(
            `> failed to flush messages to ${this.config.url}: ${error.message}`,
        );
        this.logger.info(`> resetting session: ${this.session?.id}`);
        this.session = undefined;
        throw error;
    }
}
