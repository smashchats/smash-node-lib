import type { IMProfile } from '@src/shared/lexicon/improto.lexicon.js';
import type { DIDDocument } from '@src/shared/types/did.types.js';

export interface SmashProfile {
    did: DIDDocument;
    meta?: IMProfile;
    scores?: Record<string, number>;
}

export type SmashProfileList = SmashProfile[];
