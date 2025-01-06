import type { IECKeyPair } from '2key-ratchet';
import type { IMPeerIdentity } from '@src/core/identity/IMPeerIdentity.js';
import type { SmashEndpoint } from '@src/shared/types/sme.types.js';

export type DIDMethod = 'key' | 'web' | 'plc' | 'doc';
export type DIDString = `did:${DIDMethod}:${string}`;
export type DID = DIDString | DIDDocument;

export interface IDIDResolver {
    readonly method: DIDMethod;
    resolve(did: DID): Promise<DIDDocument>;
    generate(): Promise<IMPeerIdentity>;
    generateNewPreKeyPair(identity: IMPeerIdentity): Promise<IECKeyPair>;
}

export interface DIDDocument {
    id: DIDString;
    ik: string;
    ek: string;
    signature: string;
    endpoints: SmashEndpoint[];
}
