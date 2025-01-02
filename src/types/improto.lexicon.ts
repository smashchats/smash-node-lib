import {
    BaseIMProtoMessage,
    DID,
    DIDDocument,
    IMProtoMessage,
    SmashEndpoint,
    sha256,
    undefinedString,
} from '@src/types/index.js';

export const IM_CHAT_TEXT = 'org.improto.chat.text';
export const IM_PROFILE = 'org.improto.profile';
export const IM_DID_DOCUMENT = 'org.improto.did.document';
export const IM_SESSION_RESET = 'org.improto.session.reset';
export const IM_ACK_RECEIVED = 'org.improto.ack.received';
export const IM_ACK_READ = 'org.improto.ack.read';
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
        public after: sha256 | undefinedString = '',
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
 * DID document message
 *
 * Used to trustfully share the fully-resolved DID document from peer to peer.
 */
export interface IMDIDDocumentMessage extends IMProtoMessage {
    type: typeof IM_DID_DOCUMENT;
    data: DIDDocument;
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
