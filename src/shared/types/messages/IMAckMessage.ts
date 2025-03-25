import {
    IM_ACK_READ,
    IM_ACK_RECEIVED,
} from '@src/shared/lexicon/improto.lexicon.js';
import { BaseIMProtoMessage } from '@src/shared/types/message.types.js';
import { sha256 } from '@src/shared/types/string.types.js';

interface IMACKMessage extends BaseIMProtoMessage {
    type: typeof IM_ACK_RECEIVED | typeof IM_ACK_READ;
    data: sha256[];
    after: '';
}

/**
 * Received ACK message
 *
 * Used to acknowledge the receipt of a message.
 */
export interface IMReceivedACKMessage extends IMACKMessage {
    type: typeof IM_ACK_RECEIVED;
}

export type MessageStatus = 'delivered' | 'received' | 'read';

/**
 * Read ACK message
 *
 * Used to acknowledge the reading of a message.
 */
export interface IMReadACKMessage extends IMACKMessage {
    type: typeof IM_ACK_READ;
}
