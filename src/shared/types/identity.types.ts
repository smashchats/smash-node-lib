import type { IJsonIdentity } from '2key-ratchet';
import type { DIDString } from '@src/shared/types/did.types.js';
import type { SmashEndpoint } from '@src/shared/types/sme.types.js';

export type IIMPeerIdentity = IJsonIdentity & {
    did: DIDString;
    endpoints: SmashEndpoint[];
};

export interface IJWKJson extends CryptoKey {
    jwk?: JsonWebKey;
}

export interface IJWKJsonKeyPair {
    privateKey: IJWKJson;
    publicKey: IJWKJson;
    thumbprint?: string;
}
