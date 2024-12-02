import { SmashDID, SmashProfile } from '@src/types/did.types.js';

type sha256 = string;

// TODO: review semantic naming (with GPT???)

/**
 * Base message interface
 *
 * @see EncapsulatedSmashMessage
 */
export interface SmashMessage {
    type:
        | 'join'
        | 'discover'
        | 'text'
        | 'profile'
        | 'profiles'
        | 'action'
        | 'session_reset';
    data: unknown;
    after?: sha256;
}

/**
 * Encapsulated message interface
 *
 * Generic message interface used to send messages over the Smash protocol.
 */
export interface EncapsulatedSmashMessage extends SmashMessage {
    sha256: sha256;
    timestamp: string;
}

/**
 * Join message
 *
 * Used to join a Neighborhood. Must be sent to a Neighborhood's NAB.
 */
export interface JoinSmashMessage extends SmashMessage {
    type: 'join';
}

/**
 * Profile message
 *
 * Used to send one's Profile to a peer.
 */
export interface ProfileSmashMessage extends SmashMessage {
    type: 'profile';
    data: SmashProfile;
}

/**
 * Profile list message
 *
 * Used to share an arbitrary Profile list with a peer.
 */
export interface ProfileListSmashMessage extends SmashMessage {
    type: 'profiles';
    data: SmashProfile[];
}

/**
 * Action message
 *
 * Used to express a relationship with a peer.
 * Usually sent to a peer's NAB to build a graph of relationships.
 */
export interface ActionSmashMessage extends SmashMessage {
    type: 'action';
    data: ActionData;
}
export type Relationship = 'smash' | 'pass' | 'clear' | 'block';
export interface ActionData {
    target: SmashDID;
    action: Relationship;
}

/**
 * Chat message
 *
 * Used to send a chat message from a peer to another.
 */
export interface SmashChatMessage extends SmashMessage {
    type: 'text';
    data: string;
    after: sha256;
}

/**
 * Session Reset message
 *
 * Used to request a peer to reset all sessions with them.
 */
export interface SessionResetSmashMessage extends SmashMessage {
    type: 'session_reset';
    data: undefined;
}
