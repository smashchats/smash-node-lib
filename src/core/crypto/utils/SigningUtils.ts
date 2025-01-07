import type { ECPublicKey } from '2key-ratchet';
import { CryptoManager } from '@src/core/crypto/engine/CryptoManager.js';
import { BufferUtils } from '@src/core/crypto/utils/BufferUtils.js';
import { CurveUtils } from '@src/core/crypto/utils/CurveUtils.js';

export class SigningUtils extends CryptoManager {
    static async signAsString(
        signingKey: CryptoKey,
        message: ArrayBuffer,
    ): Promise<string> {
        return BufferUtils.bufferToString(
            await CurveUtils.sign(signingKey, message),
        );
    }

    static async verify(
        verifyKey: CryptoKey,
        signature: string | ArrayBuffer,
        message: ArrayBuffer,
    ): Promise<boolean> {
        const signatureBuffer =
            typeof signature === 'string'
                ? BufferUtils.stringToBuffer(signature)
                : signature;
        return CurveUtils.verify(verifyKey, signatureBuffer, message);
    }

    static async verifyOwnedKey(
        signingKey: ECPublicKey,
        ownedKey: ECPublicKey,
        signature: ArrayBuffer,
    ): Promise<boolean> {
        return CurveUtils.verify(
            signingKey.key,
            signature,
            ownedKey.serialize(),
        );
    }
}
