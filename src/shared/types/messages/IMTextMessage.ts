import { IM_CHAT_TEXT } from '@src/shared/lexicon/improto.lexicon.js';
import { IMProtoMessage } from '@src/shared/types/message.types.js';
import { sha256, undefinedString } from '@src/shared/types/string.types.js';

/**
 * Chat message
 *
 * Used to send a chat message from a peer to another.
 */
export interface IMTextMessage extends IMProtoMessage {
    type: typeof IM_CHAT_TEXT;
    data: string;
}

export class IMText implements IMTextMessage {
    public type = IM_CHAT_TEXT as typeof IM_CHAT_TEXT;
    constructor(
        public data: string,
        public after: sha256 | undefinedString = '',
    ) {}
}
