import type { SMEConfigJSON } from '@src/shared/types/sme.types.js';

export const SME_DEFAULT_CONFIG: Omit<SMEConfigJSON, 'url' | 'smePublicKey'> = {
    keyAlgorithm: { name: 'ECDH', namedCurve: 'P-256' },
    encryptionAlgorithm: { name: 'AES-GCM', length: 256 },
    challengeEncoding: 'base64' as const,
};
