import { IM_PART } from '@src/shared/lexicon/improto.lexicon.js';
import type { EncapsulatedIMProtoMessage } from '@src/shared/types/message.types.js';
import type { IMPartData } from '@src/shared/types/messages/IMPartMessage.js';
import { Logger } from '@src/shared/utils/Logger.js';

// 512KB in bytes - this could be made configurable if needed
const MAX_MESSAGE_SIZE = 512 * 1024;

export class MessageSplitter {
    constructor(private readonly logger: Logger) {}

    /**
     * Check if a message needs to be split into parts based on its size
     */
    public needsSplitting(message: EncapsulatedIMProtoMessage): boolean {
        const messageSize = this.getMessageSize(message);
        this.logger.debug(
            `Message size: ${messageSize} bytes (max: ${MAX_MESSAGE_SIZE} bytes)`,
        );
        return messageSize > MAX_MESSAGE_SIZE;
    }

    /**
     * Split a message into parts if it exceeds the size limit.
     * Each part will contain a portion of the original message data.
     */
    public split(
        message: EncapsulatedIMProtoMessage,
    ): EncapsulatedIMProtoMessage[] {
        if (!message?.sha256) {
            throw new Error('Cannot split message: missing SHA256');
        }

        if (!this.needsSplitting(message)) {
            this.logger.debug(
                'Message is within size limit, no splitting needed',
            );
            return [message];
        }

        // Only stringify once
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
                originalData: null, // Full message data not needed in parts
                partNumber: i,
                totalParts,
                originalSha256: message.sha256,
                content: partContent, // No need for base64 encoding
            };

            const partMessage: EncapsulatedIMProtoMessage = {
                type: IM_PART,
                data: partData,
                after: message.after,
                sha256: message.sha256,
                timestamp: message.timestamp,
            };

            this.logger.debug(
                `Created part ${i + 1}/${totalParts} (${partContent.length} bytes)`,
            );

            parts.push(partMessage);
        }

        return parts;
    }

    /**
     * Calculate the size of a message in bytes
     */
    private getMessageSize(message: EncapsulatedIMProtoMessage): number {
        return JSON.stringify(message).length;
    }
}
