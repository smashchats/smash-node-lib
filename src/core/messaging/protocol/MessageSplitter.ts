import { encapsulateMessage } from '@src/api/tools/encapsulateMessage.js';
import { MAX_MESSAGE_SIZE } from '@src/shared/constants/protocol.js';
import { IM_PART } from '@src/shared/lexicon/improto.lexicon.js';
import {
    MessageStatusDelivered,
    onMessagesStatusFn,
} from '@src/shared/types/index.js';
import type {
    EncapsulatedIMProtoMessage,
    IMProtoMessage,
} from '@src/shared/types/message.types.js';
import type { IMPartData } from '@src/shared/types/messages/IMPartMessage.js';
import { sha256 } from '@src/shared/types/string.types.js';
import { Logger } from '@src/shared/utils/Logger.js';

interface PartsCounter {
    originalSha256: sha256;
    counter: number;
}

export class MessageSplitter {
    private readonly sending: Map<sha256, PartsCounter> = new Map();

    constructor(
        private readonly logger: Logger,
        private readonly onMessagesStatusCallback: onMessagesStatusFn,
    ) {}

    /**
     * Split a message into parts.
     * Each part will contain a portion of the original message data.
     */
    public async split(
        message: EncapsulatedIMProtoMessage,
    ): Promise<EncapsulatedIMProtoMessage[]> {
        if (!message?.sha256) {
            throw new Error('Cannot split message: missing SHA256');
        }

        const messageJson = JSON.stringify(message);
        const totalParts = Math.ceil(messageJson.length / MAX_MESSAGE_SIZE);

        this.logger.info(
            `Splitting message (${messageJson.length} bytes) into ${totalParts} parts`,
        );

        const parts: EncapsulatedIMProtoMessage[] = [];

        for (let i = 0; i < totalParts; i++) {
            const start = i * MAX_MESSAGE_SIZE;
            const end = Math.min(start + MAX_MESSAGE_SIZE, messageJson.length);
            const partContent = messageJson.slice(start, end);

            const partData: IMPartData = {
                originalType: message.type,
                partNumber: i,
                totalParts,
                originalSha256: message.sha256,
                content: partContent, // No need for base64 encoding
            };

            this.logger.debug(
                `Created part ${i + 1}/${totalParts} (${partContent.length} bytes)`,
            );

            parts.push(
                await encapsulateMessage({
                    type: IM_PART,
                    data: partData,
                    after: '',
                }),
            );
        }
        const counter = {
            counter: parts.length,
            originalSha256: message.sha256,
        } as PartsCounter;
        parts.forEach((part) => this.sending.set(part.sha256, counter));
        return parts;
    }

    /**
     * Calculate the size of a message in bytes
     */
    public static getMessageSize(message: IMProtoMessage): number {
        return JSON.stringify(message).length;
    }

    /**
     * ACK potential parts as being delivered
     * @param parts - Array of message parts to be marked as delivered.
     */
    public markAsDelivered(parts: sha256[]) {
        if (this.sending.size === 0) return;
        this.logger.debug(
            `Trying to mark ${parts.length} potential parts as delivered`,
        );
        parts.forEach((part) => this.markPartAsDelivered(part));
    }

    private markPartAsDelivered(part: sha256) {
        const counter = this.sending.get(part);
        if (counter) {
            this.logger.debug(`Marking part ${part} as delivered`);
            if (--counter.counter === 0) {
                this.sending.delete(part);
                this.logger.debug(
                    `All parts have been delivered for ${counter.originalSha256}`,
                );
                this.onMessagesStatusCallback(MessageStatusDelivered, [
                    counter.originalSha256,
                ]);
            }
        }
    }
}
