import {
    IMSessionResetMessage,
    IM_SESSION_RESET,
} from '@src/types/improto.lexicon.js';
import {
    SMASH_NBH_DISCOVER,
    SMASH_NBH_JOIN,
    SmashChatDiscoverMessage,
    SmashChatJoinMessage,
} from '@src/types/smashchats.lexicon.js';
import { SMEConfigJSON } from '@src/types/sme.types.js';

export const EXPIRATION_TIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const IM_RESET_SESSION_MESSAGE = {
    type: IM_SESSION_RESET,
    data: undefined,
    after: '0',
} as IMSessionResetMessage;

export const SMASH_NBH_JOIN_MESSAGE = {
    type: SMASH_NBH_JOIN,
    data: undefined,
    after: '0',
} as SmashChatJoinMessage;

export const SMASH_NBH_DISCOVER_MESSAGE = {
    type: SMASH_NBH_DISCOVER,
    data: undefined,
    after: '0',
} as SmashChatDiscoverMessage;

export const SME_DEFAULT_CONFIG: Omit<SMEConfigJSON, 'url' | 'smePublicKey'> = {
    keyAlgorithm: { name: 'ECDH', namedCurve: 'P-256' } as KeyAlgorithm,
    encryptionAlgorithm: { name: 'AES-GCM', length: 256 },
    challengeEncoding: 'base64' as const,
};
