import type { EncapsulatedIMProtoMessage } from '@src/shared/types/message.types.js';
import type { MessageStatus } from '@src/shared/types/messages/index.js';
import type { sha256 } from '@src/shared/types/string.types.js';

export type onMessagesFn = (
    peerIk: string,
    messages: EncapsulatedIMProtoMessage[],
) => void;

export type onMessagesStatusFn = (status: MessageStatus, ids: sha256[]) => void;
