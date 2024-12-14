import { DID, IMProtoMessage } from '@src/types/index.js';

/**
 * Chat message
 *
 * Used to send a chat message from a peer to another.
 */
export interface IMTextMessage extends IMProtoMessage {
    type: 'org.improto.chat.text';
    data: string;
}

export interface IMProfile {
    version?: 1;
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
    type: 'org.improto.profile';
    data: IMProfile;
}

/**
 * Session Reset message
 *
 * Used to request a peer to reset all sessions with them.
 */
export interface IMSessionResetMessage extends IMProtoMessage {
    type: 'org.improto.session.reset';
    data: never;
}
