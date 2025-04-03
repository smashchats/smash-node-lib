import { IM_PART } from '@src/shared/lexicon/improto.lexicon.js';
import { IMProtoMessage } from '@src/shared/types/message.types.js';
import { base64Content, sha256 } from '@src/shared/types/string.types.js';

/**
 * Message part data
 */
export interface IMPartData {
    /** The original message type */
    originalType: string;
    /** The original message data */
    originalData: unknown;
    /** The part number (0-based) */
    partNumber: number;
    /** Total number of parts */
    totalParts: number;
    /** The original message SHA256 */
    originalSha256: sha256;
    /** The part content */
    content: base64Content;
}

/**
 * Message part message
 *
 * Used to send parts of a large message that exceeds the size limit.
 * Parts are automatically reassembled by the receiving peer.
 */
export interface IMPartMessage extends IMProtoMessage {
    type: typeof IM_PART;
    data: IMPartData;
}
