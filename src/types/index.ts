import type { IJsonIdentity } from '2key-ratchet';
import type { DIDString } from '@src/types/did.types.js';
import { EncapsulatedIMProtoMessage } from '@src/types/message.types.js';
import { SmashEndpoint } from '@src/types/sme.types.js';

export type { Identity, IECKeyPair, IJsonIdentity } from '2key-ratchet';

export * from '@src/types/action.types.js';
export * from '@src/types/callbacks.types.js';
export * from '@src/types/did.types.js';
export * from '@src/types/improto.lexicon.js';
export * from '@src/types/message.types.js';
export * from '@src/types/smash.types.js';
export * from '@src/types/smashchats.lexicon.js';
export * from '@src/types/sme.types.js';

export const ENCODING = 'base64';
// base64 vs base64url?
// base64url is the same as base64 but without the padding and with a few characters replaced
// to avoid problems with special characters in URLs.

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

export type Firehose = (
    sender: DIDString,
    messages: EncapsulatedIMProtoMessage[],
) => Promise<void>;
