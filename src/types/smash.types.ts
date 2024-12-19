import { DIDDocument, IMProfile } from '@src/types/index.js';

export interface SmashProfile {
    did: DIDDocument;
    meta?: IMProfile;
    scores?: Record<string, number>;
}

export type SmashProfileList = SmashProfile[];
