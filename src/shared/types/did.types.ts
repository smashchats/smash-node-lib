import type { IECKeyPair } from '2key-ratchet';
import type { IMPeerIdentity } from '@src/core/identity/IMPeerIdentity.js';
import type { SmashEndpoint } from '@src/shared/types/sme.types.js';

export type DIDMethod = 'key' | 'web' | 'plc' | 'doc';
export type DIDString = `did:${DIDMethod}:${string}`;
export type DID = DIDString | DIDDocument;

export interface IDIDResolver {
    /**
     * The DID method this resolver implements
     * https://www.w3.org/TR/did-core/#methods
     */
    readonly method: DIDMethod;

    /**
     * Resolves a DID to its DID document
     * https://www.w3.org/TR/did-core/#did-resolution
     * @param did
     */
    resolve(did: DID): Promise<DIDDocument>;

    /**
     * Generates a new peer identity
     * TODO: use standard DID document syntax to export private keys as well
     */
    generate(): Promise<IMPeerIdentity>;
    generateNewPreKeyPair(identity: IMPeerIdentity): Promise<IECKeyPair>;
}

/**
 * extracted DID document information useful to the Smash protocol
 */
export interface DIDDocument {
    /**
     * The canonical DID: https://www.w3.org/TR/did-core/#did-syntax
     */
    id: DIDString;
    /**
     * Identity Key for use in the Smash Protocol
     */
    ik: string;
    /**
     * Exchange Key for use in the Smash Protocol
     */
    ek: string;
    /**
     * Signature of EK by IK
     */
    signature: string;
    /**
     * Endpoints for use in the Smash Protocol
     */
    endpoints: SmashEndpoint[];
}
