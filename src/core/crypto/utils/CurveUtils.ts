import { CryptoManager } from '@src/core/crypto/engine/CryptoManager.js';
import { ECDSA_ALG } from '@src/shared/constants/algorithms.js';

export class CurveUtils extends CryptoManager {
    static async sign(
        signingKey: CryptoKey,
        message: ArrayBuffer,
    ): Promise<ArrayBuffer> {
        return await this.crypto.subtle.sign(
            { ...ECDSA_ALG, hash: ECDSA_ALG.hash },
            signingKey,
            message,
        );
    }

    static async verify(
        verifyKey: CryptoKey,
        signature: ArrayBuffer,
        message: ArrayBuffer,
    ): Promise<boolean> {
        return await this.crypto.subtle.verify(
            { ...ECDSA_ALG, hash: ECDSA_ALG.hash },
            verifyKey,
            signature,
            message,
        );
    }

    static async deriveKey(
        privateKey: CryptoKey,
        publicKey: CryptoKey,
    ): Promise<CryptoKey> {
        return await this.crypto.subtle.deriveKey(
            { name: 'ECDH', public: publicKey },
            privateKey,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt'],
        );
    }

    static async deriveBits(
        privateKey: CryptoKey,
        publicKey: CryptoKey,
    ): Promise<ArrayBuffer> {
        return await this.crypto.subtle.deriveBits(
            { name: 'ECDH', public: publicKey },
            privateKey,
            256,
        );
    }
}
