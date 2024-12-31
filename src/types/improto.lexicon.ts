import {
    BaseIMProtoMessage,
    DID,
    IMProtoMessage,
    SmashEndpoint,
    sha256,
} from '@src/types/index.js';

export const IM_CHAT_TEXT = 'org.improto.chat.text';
export const IM_PROFILE = 'org.improto.profile';
export const IM_SESSION_RESET = 'org.improto.session.reset';
export const IM_ACK_RECEIVED = 'org.improto.ack.received';
export const IM_SESSION_ENDPOINT = 'org.improto.session.endpoint';

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
        public after: sha256 | undefined = undefined,
    ) {}
}

export interface IMProfile {
    version?: 1;
    // TODO: is it useful to have a DID here?
    did: DID;
    title: string;
    description: string;
    avatar: string;
}

/**
 * Profile message
 *
 * Used to send one's Profile to a peer.
 */
export interface IMProfileMessage extends IMProtoMessage {
    type: typeof IM_PROFILE;
    data: IMProfile;
}

/**
 * Session Reset message
 *
 * Used to request a peer to reset all sessions with them.
 */
export interface IMSessionResetMessage extends IMProtoMessage {
    type: typeof IM_SESSION_RESET;
    data: never;
}

/**
 * Session Endpoint message
 *
 * Used to request a peer to reset all sessions with them.
 */
export interface IMSessionEndpointMessage extends IMProtoMessage {
    type: typeof IM_SESSION_ENDPOINT;
    data: SmashEndpoint;
}

/**
 * Received ACK message
 *
 * Used to acknowledge the receipt of a message.
 */
export interface IMReceivedACKMessage extends BaseIMProtoMessage {
    type: typeof IM_ACK_RECEIVED;
    data: sha256[];
    after: undefined;
}

export type MessageStatus = '' | 'delivered' | 'received';
