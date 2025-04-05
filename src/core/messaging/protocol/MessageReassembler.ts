import type { EncapsulatedIMProtoMessage } from '@src/shared/types/message.types.js';
import type { IMPartData } from '@src/shared/types/messages/IMPartMessage.js';
import { Logger } from '@src/shared/utils/Logger.js';

interface PartMessage {
    data: IMPartData;
    after: string;
    timestamp: string;
}

export class MessageReassembler {
    private readonly parts = new Map<string, PartMessage[]>();

    constructor(private readonly logger: Logger) {}

    /**
     * Add a part message and return the reassembled message if all parts are received
     */
    public addPart(
        part: EncapsulatedIMProtoMessage,
    ): EncapsulatedIMProtoMessage | null {
        const partData = part.data as IMPartData;
        const originalSha256 = partData.originalSha256;

        this.logger.debug(
            `Adding part ${partData.partNumber + 1}/${partData.totalParts} for message ${originalSha256}`,
        );

        if (!this.parts.has(originalSha256)) {
            this.logger.debug(
                `Creating new parts array for message ${originalSha256}`,
            );
            this.parts.set(originalSha256, []);
        }

        const messageParts = this.parts.get(originalSha256)!;

        // Check if we already have this part
        const existingPart = messageParts.find(
            (p) => p.data.partNumber === partData.partNumber,
        );
        if (existingPart) {
            this.logger.debug(
                `Part ${partData.partNumber + 1} already exists, skipping duplicate`,
            );
            return null;
        }

        messageParts.push({
            data: partData,
            after: part.after,
            timestamp: part.timestamp,
        });

        this.logger.debug(
            `Now have ${messageParts.length}/${partData.totalParts} parts for message ${originalSha256}`,
        );

        // Log current parts for debugging
        this.logger.debug(
            `Current parts for ${originalSha256}: ${messageParts.map((p) => p.data.partNumber + 1).join(', ')}`,
        );

        // Check if we have all parts
        if (messageParts.length === partData.totalParts) {
            this.logger.debug(
                `All parts received for message ${originalSha256}, reassembling...`,
            );
            return this.reassembleMessage(messageParts);
        }

        return null;
    }

    private reassembleMessage(
        parts: PartMessage[],
    ): EncapsulatedIMProtoMessage {
        const originalSha256 = parts[0].data.originalSha256;
        this.logger.debug(
            `Sorting ${parts.length} parts for message ${originalSha256}`,
        );

        // Sort parts by part number
        parts.sort((a, b) => a.data.partNumber - b.data.partNumber);

        // Verify all parts are present
        for (let i = 0; i < parts.length; i++) {
            if (parts[i].data.partNumber !== i) {
                this.logger.error(
                    `Missing part ${i} for message ${originalSha256}`,
                );
                throw new Error(
                    `Missing part ${i} for message ${originalSha256}`,
                );
            }
        }

        // Concatenate all part contents
        this.logger.debug(
            `Concatenating ${parts.length} parts for message ${originalSha256}`,
        );
        const concatenatedContent = parts.map((p) => p.data.content).join('');

        // Parse the original message from the concatenated content
        const originalMessage = JSON.parse(concatenatedContent);

        // Clean up parts
        this.logger.debug(`Cleaning up parts for message ${originalSha256}`);
        this.parts.delete(originalSha256);

        this.logger.info(
            `Reassembled message ${originalSha256} from ${parts.length} parts`,
        );

        return originalMessage;
    }
}
