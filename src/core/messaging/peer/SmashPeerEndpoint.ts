import type { SmashPeer } from '@src/core/messaging/peer/SmashPeer.js';
import { MessageSplitter } from '@src/core/messaging/protocol/MessageSplitter.js';
import type { SessionManager } from '@src/core/messaging/session/SessionManager.js';
import type { SignalSession } from '@src/core/messaging/session/SignalSession.js';
import type { SMESocketManager } from '@src/infrastructure/network/sme/SMESocketManager.js';
import { MAX_MESSAGE_SIZE } from '@src/shared/constants/protocol.js';
import type { EncapsulatedIMProtoMessage } from '@src/shared/types/message.types.js';
import type {
    MessageQueueItem,
    MessageQueueMap,
    SmashEndpoint,
} from '@src/shared/types/sme.types.js';
import type { sha256 } from '@src/shared/types/string.types.js';
import type { Logger } from '@src/shared/utils/Logger.js';
import AsyncLock from 'async-lock';

const QUEUE_MUTEX_NAME = 'queue';

export class SmashPeerEndpoint {
    private readonly mutex = new AsyncLock();
    private readonly messageQueue: MessageQueueMap;
    private session?: SignalSession;

    constructor(
        private readonly logger: Logger,
        private readonly peer: SmashPeer,
        private readonly smeSocketManager: SMESocketManager,
        private readonly sessionManager: SessionManager,
        public readonly config: SmashEndpoint,
        historicalMessageQueue: MessageQueueMap,
    ) {
        this.messageQueue = new Map([...historicalMessageQueue]);
    }

    public async queue(
        message: EncapsulatedIMProtoMessage,
        size: number,
    ): Promise<void> {
        await this.mutex.acquire(QUEUE_MUTEX_NAME, () => {
            this.addMessageToQueue(message, size);
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
            `Waiting to acquire queue mutex for ${this.config.url}`,
        );
        await this.mutex.acquire(
            QUEUE_MUTEX_NAME,
            () => {
                this.logger.debug(
                    `Acquired queue mutex for ${this.config.url}`,
                );
            },
            { skipQueue: true },
        );
    }

    public async flush(providedSession?: SignalSession): Promise<void> {
        const session = providedSession ?? (await this.getOrCreateSession());
        await this.mutex.acquire(QUEUE_MUTEX_NAME, async () => {
            this.logger.debug(`Acquired flushing mutex for ${this.config.url}`);

            if (this.messageQueue.size === 0) {
                this.logger.debug(
                    `No undelivered messages to flush for ${this.config.url}`,
                );
                return;
            }

            const messages = [
                ...(await this.initializeSessionIfNeeded(session)),
                ...Array.from(this.messageQueue.values()),
            ];
            await this.flushMessages(session, messages);
        });
    }

    public resetSession(): void {
        this.session = undefined;
    }

    private addMessageToQueue(
        message: EncapsulatedIMProtoMessage,
        size: number,
    ): void {
        this.messageQueue.set(message.sha256, {
            message,
            size,
        });
        this.logger.debug(
            `Queued ${message.sha256} for ${this.config.url} (${this.messageQueue.size})`,
        );
    }

    private removeMessagesFromQueue(messageIds: sha256[]): void {
        messageIds.forEach((messageId) => {
            this.messageQueue.delete(messageId);
            this.logger.debug(
                `Acknowledged message ${messageId} for ${this.config.url} (${this.messageQueue.size})`,
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
    ): Promise<MessageQueueItem[]> {
        if (!session.firstUse) return [];

        this.logger.debug(`Initializing first use session ${session.id}`);
        const protocolMessages = await this.getInitialProtocolMessages();

        protocolMessages.forEach((message) => {
            this.logger.debug(
                `Queueing ${message.message.type} session message for ${this.config.url}`,
            );
        });

        return protocolMessages;
    }

    private async getInitialProtocolMessages(): Promise<MessageQueueItem[]> {
        const messages: MessageQueueItem[] = [];

        try {
            const pe = this.smeSocketManager.getPreferredEndpointMessage();
            const peMessageSize = MessageSplitter.getMessageSize(pe);
            messages.push({ message: pe, size: peMessageSize });
        } catch (error) {
            this.logger.debug(
                `Skipping preferred endpoint message: ${(error as Error).message}`,
            );
        }

        const did = await this.sessionManager.getDIDMessage();
        const didMessageSize = MessageSplitter.getMessageSize(did);
        messages.push({ message: did, size: didMessageSize });

        return messages;
    }

    private async flushMessages(
        session: SignalSession,
        messages: MessageQueueItem[],
    ): Promise<void> {
        this.logger.debug(
            `Flushing ${messages.length} messages to ${this.config.url}`,
        );

        try {
            await this.sendMessagesBatched(session, messages);
            this.messageQueue.clear();
            session.firstUse = false;

            this.logger.debug(
                `Flushed ${messages.length} messages to ${this.config.url} (cleared queue)`,
            );
            this.logger.debug(messages);
        } catch (error) {
            await this.handleFlushError(error as Error);
        }
    }

    private async sendMessagesBatched(
        session: SignalSession,
        messages: MessageQueueItem[],
    ): Promise<void> {
        const socket = this.smeSocketManager.getOrCreate(this.config.url);
        const maxBatchSize = MAX_MESSAGE_SIZE * 2;

        let startIdx = 0;
        let batchNumber = 1;

        while (startIdx < messages.length) {
            let batchSize = 0;
            let endIdx = startIdx;

            while (
                endIdx < messages.length &&
                batchSize + messages[endIdx].size < maxBatchSize
            ) {
                batchSize += messages[endIdx].size;
                endIdx++;
            }

            const batch = messages.slice(startIdx, endIdx);
            this.logger.debug(
                `Sending batch ${batchNumber} of ${batch.length} messages (${batchSize} bytes) to ${this.config.url}`,
            );

            await socket.sendData(
                this.config.preKey,
                session.id,
                await session.encryptMessages(batch.map((m) => m.message)),
                batch.map((m) => m.message.sha256),
            );

            this.logger.debug(`Successfully sent batch ${batchNumber}`);
            startIdx = endIdx;
            batchNumber++;
        }
    }

    private async handleFlushError(error: Error): Promise<void> {
        this.logger.error(
            `Failed to flush messages to ${this.config.url}: ${typeof error === 'object' ? error.message : error}`,
        );
        this.logger.info(`Resetting session: ${this.session?.id}`);
        this.session = undefined;
        throw error;
    }
}
