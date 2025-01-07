import type { DIDString } from '@src/shared/types/did.types.js';
import type { IMProtoMessage } from '@src/shared/types/message.types.js';
import type { SmashProfileList } from '@src/shared/types/smash.types.js';

export const SMASH_NBH_JOIN = 'com.smashchats.nbh.join';
export const SMASH_NBH_DISCOVER = 'com.smashchats.nbh.discover';
export const SMASH_NBH_RELATIONSHIP = 'com.smashchats.relationship';
export const SMASH_PROFILE_LIST = 'com.smashchats.profiles';

export const NBH_PROFILE_LIST = 'nbh_discovered';
export const NBH_ADDED = 'nbh_added';

/**
 * Join message
 *
 * Used to join a Neighborhood.
 * Must be sent to a Neighborhood's NAB.
 */
export interface SmashChatJoinMessage extends IMProtoMessage {
    type: typeof SMASH_NBH_JOIN;
    data: never;
}

/**
 * Discover message
 *
 * Used to discover a Neighborhood.
 * Must be sent to a Neighborhood's NAB.
 */
export interface SmashChatDiscoverMessage extends IMProtoMessage {
    type: typeof SMASH_NBH_DISCOVER;
    data: never;
}

/**
 * Relationship message
 *
 * Used to express a relationship with a peer.
 * Usually sent to a peer's NAB to build a graph of relationships.
 */
export interface SmashChatRelationshipMessage extends IMProtoMessage {
    type: typeof SMASH_NBH_RELATIONSHIP;
    data: SmashChatRelationshipData;
}
export type Relationship = 'smash' | 'pass' | 'clear' | 'block';
export interface SmashChatRelationshipData {
    target: DIDString;
    action: Relationship;
}

/**
 * Profile list message
 *
 * Used to share an arbitrary Profile list with a peer.
 */
export interface SmashChatProfileListMessage extends IMProtoMessage {
    type: typeof SMASH_PROFILE_LIST;
    data: SmashProfileList;
}
