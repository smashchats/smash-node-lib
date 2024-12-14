import { DIDDocument, IMProfile } from '@src/types/index.js';

interface SmashProfile {
    did: DIDDocument;
    meta?: IMProfile;
    scores?: Record<string, number>;
}

export type SmashProfileList = SmashProfile[];
