import { SmashEndpoint } from '@src/types/index.js';

export type DIDType = 'key' | 'web' | 'plc';
export type DIDString = `did:${DIDType}:${string}`;
export type DID = DIDString | DIDDocument;

export interface DIDDocument {
    id: DIDString;
    ik: string;
    ek: string;
    signature: string;
    endpoints: SmashEndpoint[];
}
