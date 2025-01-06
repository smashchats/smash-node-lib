import type {
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
} from '@src/shared/lexicon/improto.lexicon.js';
import type {
    SMASH_NBH_DISCOVER,
    SMASH_NBH_JOIN,
    SMASH_NBH_RELATIONSHIP,
    SMASH_PROFILE_LIST,
    SmashChatDiscoverMessage,
    SmashChatJoinMessage,
    SmashChatProfileListMessage,
    SmashChatRelationshipMessage,
} from '@src/shared/lexicon/smashchats.lexicon.js';
import type { IMProtoMessage } from '@src/shared/types/message.types.js';
import type { reverseDNS } from '@src/shared/types/string.types.js';

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
