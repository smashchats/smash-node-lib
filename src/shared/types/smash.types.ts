import type { IMProfile } from '@src/shared/lexicon/improto.lexicon.js';
import type { DID } from '@src/shared/types/did.types.js';

export interface SmashProfile {
    did: DID;
    meta?: Partial<IMProfile>;
    scores?: Record<string, number>;
}

export type SmashProfileList = SmashProfile[];
