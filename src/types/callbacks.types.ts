import { EncapsulatedIMProtoMessage } from '@src/types/index.js';

export type onMessagesFn = (
    peerIk: string,
    messages: EncapsulatedIMProtoMessage[],
) => void;

export type onMessagesStatusFn = (status: string, ids: string[]) => void;
