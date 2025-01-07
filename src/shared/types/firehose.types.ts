import type { DIDString } from '@src/shared/types/did.types.js';
import type { EncapsulatedIMProtoMessage } from '@src/shared/types/message.types.js';

export type Firehose = (
    sender: DIDString,
    messages: EncapsulatedIMProtoMessage[],
) => Promise<void>;
