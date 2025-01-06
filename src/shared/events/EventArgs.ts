import type { IMProtoEventType } from '@src/shared/events/IMProtoEventMap.js';
import type { MessagingEventMap } from '@src/shared/events/MessagingEventMap.js';
import type { DIDString } from '@src/shared/types/did.types.js';
import type { reverseDNS } from '@src/shared/types/string.types.js';

export type EventArgs<T extends string> = T extends keyof MessagingEventMap
    ? MessagingEventMap[T]
    : T extends reverseDNS
      ? [did: DIDString, message: IMProtoEventType<T>]
      : never;
