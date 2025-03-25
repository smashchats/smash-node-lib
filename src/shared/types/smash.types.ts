import type { DID } from '@src/shared/types/did.types.js';
import type { IMProfile } from '@src/shared/types/messages/index.js';

export interface SmashProfile {
    did: DID;
    meta?: Partial<IMProfile>;
    scores?: Record<string, number>;
}

export type SmashProfileList = SmashProfile[];
