import { encapsulateMessage } from '@src/api/tools/encapsulateMessage.js';
import { MAX_MESSAGE_SIZE } from '@src/shared/constants/protocol.js';
import { IM_PART } from '@src/shared/lexicon/improto.lexicon.js';
import type {
    EncapsulatedIMProtoMessage,
    IMProtoMessage,
} from '@src/shared/types/message.types.js';
import type { IMPartData } from '@src/shared/types/messages/IMPartMessage.js';
import { Logger } from '@src/shared/utils/Logger.js';

export class MessageSplitter {
    /**
     * Split a message into parts.
     * Each part will contain a portion of the original message data.
     */
    public static async split(
        logger: Logger,
        message: EncapsulatedIMProtoMessage,
    ): Promise<EncapsulatedIMProtoMessage[]> {
        if (!message?.sha256) {
            throw new Error('Cannot split message: missing SHA256');
        }

        const messageJson = JSON.stringify(message);
        const totalParts = Math.ceil(messageJson.length / MAX_MESSAGE_SIZE);

        logger.info(
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

            logger.debug(
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
        return parts;
    }

    /**
     * Calculate the size of a message in bytes
     */
    public static getMessageSize(message: IMProtoMessage): number {
        return JSON.stringify(message).length;
    }
}
