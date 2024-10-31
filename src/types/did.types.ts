import { SmashEndpoint } from '@src/types/sme.types.js';

export interface SmashDID {
    ik: string;
    ek: string;
    signature: string;
    endpoints: SmashEndpoint[];
}

export interface SmashProfileMeta {
    title: string;
    description: string;
    picture: string;
}

export interface SmashProfile {
    meta?: SmashProfileMeta;
    did: SmashDID;
    scores?: Record<string, number>;
}
