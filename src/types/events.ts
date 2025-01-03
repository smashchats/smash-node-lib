import { SmashPeer } from '@src/SmashPeer.js';
import { DIDString } from '@src/types/did.types.js';
import {
    IMDIDDocumentMessage,
    IMProfileMessage,
    IMReadACKMessage,
    IMReceivedACKMessage,
    IMSessionEndpointMessage,
    IMSessionResetMessage,
    IMTextMessage,
    IM_ACK_READ,
    IM_ACK_RECEIVED,
    IM_CHAT_TEXT,
    IM_DID_DOCUMENT,
    IM_PROFILE,
    IM_SESSION_ENDPOINT,
    IM_SESSION_RESET,
    MessageStatus,
} from '@src/types/improto.lexicon.js';
import {
    IMProtoMessage,
    reverseDNS,
    sha256,
} from '@src/types/message.types.js';
import {
    SMASH_NBH_DISCOVER,
    SMASH_NBH_JOIN,
    SMASH_NBH_RELATIONSHIP,
    SMASH_PROFILE_LIST,
    SmashChatDiscoverMessage,
    SmashChatJoinMessage,
    SmashChatProfileListMessage,
    SmashChatRelationshipMessage,
} from '@src/types/smashchats.lexicon.js';

// Map of known event types to their corresponding message types
export type IMProtoEventMap = {
    [IM_CHAT_TEXT]: IMTextMessage;
    [IM_PROFILE]: IMProfileMessage;
    [IM_DID_DOCUMENT]: IMDIDDocumentMessage;
    [IM_SESSION_RESET]: IMSessionResetMessage;
    [IM_SESSION_ENDPOINT]: IMSessionEndpointMessage;
    [IM_ACK_RECEIVED]: IMReceivedACKMessage;
    [IM_ACK_READ]: IMReadACKMessage;
    [SMASH_NBH_JOIN]: SmashChatJoinMessage;
    [SMASH_NBH_DISCOVER]: SmashChatDiscoverMessage;
    [SMASH_NBH_RELATIONSHIP]: SmashChatRelationshipMessage;
    [SMASH_PROFILE_LIST]: SmashChatProfileListMessage;
};

export type IMProtoEventType<T extends reverseDNS> =
    T extends keyof IMProtoEventMap ? IMProtoEventMap[T] : IMProtoMessage;

// Custom events map their names to tuple types of their arguments
export interface MessagingEventMap {
    status: [MessageStatus, sha256[]];
    data: [DIDString, IMProtoMessage];
}
// Allow extending this type
// declare module './events' {
//     interface MessagingEventMap {
//         'peer': { peerId: string; timestamp: number };
//     }
// }

// Helper type to get event args type, defaulting to IMProto signature
export type EventArgs<T extends string> = T extends keyof MessagingEventMap
    ? MessagingEventMap[T]
    : T extends reverseDNS
      ? [did: DIDString, message: IMProtoEventType<T>, peer?: SmashPeer]
      : never;
