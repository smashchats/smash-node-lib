import type { MessageStatus } from '@src/shared/lexicon/improto.lexicon.js';
import type { DIDString } from '@src/shared/types/did.types.js';
import type { EncapsulatedIMProtoMessage } from '@src/shared/types/message.types.js';
import type { sha256 } from '@src/shared/types/string.types.js';

// Custom events map their names to tuple types of their arguments
export interface MessagingEventMap {
    status: [MessageStatus, sha256[]];
    data: [DIDString, EncapsulatedIMProtoMessage];
}
// Allow extending this type
// declare module './events' {
//     interface MessagingEventMap {
//         'peer': { peerId: string; timestamp: number };
//     }
// }
