import { DID, IMProtoMessage } from '@src/types/index.js';

export const IM_CHAT_TEXT = 'org.improto.chat.text';
export const IM_PROFILE = 'org.improto.profile';
export const IM_SESSION_RESET = 'org.improto.session.reset';

/**
 * Chat message
 *
 * Used to send a chat message from a peer to another.
 */
export interface IMTextMessage extends IMProtoMessage {
    type: typeof IM_CHAT_TEXT;
    data: string;
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
