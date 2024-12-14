import { DID, IMProtoMessage, SmashProfileList } from '@src/types/index.js';

/**
 * Join message
 *
 * Used to join a Neighborhood.
 * Must be sent to a Neighborhood's NAB.
 */
export interface SmashChatJoinMessage extends IMProtoMessage {
    type: 'com.smashchats.nbh.join';
    data: never;
}

/**
 * Discover message
 *
 * Used to discover a Neighborhood.
 * Must be sent to a Neighborhood's NAB.
 */
export interface SmashChatDiscoverMessage extends IMProtoMessage {
    type: 'com.smashchats.nbh.discover';
    data: never;
}

/**
 * Relationship message
 *
 * Used to express a relationship with a peer.
 * Usually sent to a peer's NAB to build a graph of relationships.
 */
export interface SmashChatRelationshipMessage extends IMProtoMessage {
    type: 'com.smashchats.relationship';
    data: SmashChatRelationshipData;
}
export type Relationship = 'smash' | 'pass' | 'clear' | 'block';
export interface SmashChatRelationshipData {
    target: DID;
    action: Relationship;
}

/**
 * Profile list message
 *
 * Used to share an arbitrary Profile list with a peer.
 */
export interface SmashChatProfileListMessage extends IMProtoMessage {
    type: 'com.smashchats.profiles';
    data: SmashProfileList;
}
