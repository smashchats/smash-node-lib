// Re-exports specific types from the '2key-ratchet' library
export type {
    ECPublicKey,
    Identity,
    IECKeyPair,
    IJsonIdentity,
} from '2key-ratchet';

export * from '@src/types/action.types.js';
export * from '@src/types/callbacks.types.js';
export * from '@src/types/did.types.js';
export * from '@src/types/improto.lexicon.js';
export * from '@src/types/message.types.js';
export * from '@src/types/smash.types.js';
export * from '@src/types/smashchats.lexicon.js';
export * from '@src/types/sme.types.js';

export const ENCODING = 'base64';
