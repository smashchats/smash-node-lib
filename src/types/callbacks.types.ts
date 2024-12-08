import { EncapsulatedSmashMessage } from './index.js';

export type onMessagesFn = (
    peerIk: string,
    messages: EncapsulatedSmashMessage[],
) => void;

export type onMessagesStatusFn = (ids: string[], status: string) => void;
