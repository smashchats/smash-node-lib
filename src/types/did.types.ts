import { SmashEndpoint } from '@src/types/sme.types.js';

export interface SmashDID {
    ik: string;
    ek: string;
    signature: string;
    endpoints: SmashEndpoint[];
}

export interface SmashProfile {
    title: string;
    did: SmashDID;
    scores?: Record<string, number>;
}
