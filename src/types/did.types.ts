import { SmashEndpoint } from '@src/types/sme.types.js';

export interface SmashDID {
    ik: string;
    ek: string;
    signature: string;
    endpoints: SmashEndpoint[];
}
