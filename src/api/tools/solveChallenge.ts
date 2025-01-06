import { BufferUtils } from '@src/core/crypto/utils/BufferUtils.js';
import { CryptoUtils } from '@src/core/crypto/utils/CryptoUtils.js';
import { KeyUtils } from '@src/core/crypto/utils/KeyUtils.js';
import { SMEConfig } from '@src/shared/types/sme.types.js';

export const solveChallenge = async (
    data: { iv: string; challenge: string },
    auth: SMEConfig,
) => {
    const ivBuffer = BufferUtils.stringToBuffer(
        data.iv,
        auth.challengeEncoding,
    );
    const challengeBuffer = BufferUtils.stringToBuffer(
        data.challenge,
        auth.challengeEncoding,
    );
    const smePublicKey = await KeyUtils.importKey(
        auth.smePublicKey,
        auth.keyAlgorithm,
    );
    const symmetricKey = await CryptoUtils.deriveKey(
        {
            ...auth.keyAlgorithm,
            public: smePublicKey,
        },
        auth.preKeyPair.privateKey,
        auth.encryptionAlgorithm,
        false,
        ['encrypt', 'decrypt'],
    );
    const unencryptedChallenge = await CryptoUtils.decrypt(
        {
            ...auth.encryptionAlgorithm,
            iv: new Uint8Array(ivBuffer),
        },
        symmetricKey,
        challengeBuffer,
    );
    return BufferUtils.bufferToString(
        unencryptedChallenge,
        auth.challengeEncoding,
    );
};
