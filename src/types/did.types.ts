import { SmashEndpoint } from '@src/types/sme.types.js';

export interface SmashDID {
    id: string;
    ik: string;
    ek: string;
    signature: string;
    endpoints: SmashEndpoint[];
}

export interface SmashProfileMeta {
    title: string;
    description: string;
    // temporary made optional to allow diff updates
    picture?: string;
}

export interface SmashProfile {
    meta?: SmashProfileMeta;
    did: SmashDID;
    scores?: Record<string, number>;
}
