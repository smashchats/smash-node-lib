import {
    EncapsulatedIMProtoMessage,
    MessageStatus,
    sha256,
} from '@src/types/index.js';

export type onMessagesFn = (
    peerIk: string,
    messages: EncapsulatedIMProtoMessage[],
) => void;

export type onMessagesStatusFn = (status: MessageStatus, ids: sha256[]) => void;
