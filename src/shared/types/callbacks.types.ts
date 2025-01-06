import type { MessageStatus } from '@src/shared/lexicon/improto.lexicon.js';
import type { EncapsulatedIMProtoMessage } from '@src/shared/types/message.types.js';
import type { sha256 } from '@src/shared/types/string.types.js';

export type onMessagesFn = (
    peerIk: string,
    messages: EncapsulatedIMProtoMessage[],
) => void;

export type onMessagesStatusFn = (status: MessageStatus, ids: sha256[]) => void;
