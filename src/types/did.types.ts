import { SmashEndpoint } from '@src/types/index.js';

export type DIDMethod = 'key' | 'web' | 'plc' | 'doc';
export type DIDString = `did:${DIDMethod}:${string}`;
export type DID = DIDString | DIDDocument;

export interface DIDDocument {
    id: DIDString;
    ik: string;
    ek: string;
    signature: string;
    endpoints: SmashEndpoint[];
}
