import { CryptoManager } from '@src/core/crypto/engine/CryptoManager.js';
import { BufferUtils } from '@src/core/crypto/utils/BufferUtils.js';
import { ECDH_ALG, ECDSA_ALG } from '@src/shared/constants/algorithms.js';
import { ENCODING } from '@src/shared/constants/encoding.js';

export class KeyUtils extends CryptoManager {
    static async importKey(
        keyEncoded: string,
        keyAlgorithm: KeyAlgorithm = ECDH_ALG,
        exportable: boolean = true,
        usages: KeyUsage[] = [],
        encoding: BufferEncoding = ENCODING,
    ): Promise<CryptoKey> {
        return await this.crypto.subtle.importKey(
            'spki',
            BufferUtils.stringToBuffer(keyEncoded, encoding),
            keyAlgorithm,
            exportable,
            usages,
        );
    }

    static async importSigningPublicKey(
        keyEncoded: string,
        encoding: BufferEncoding = ENCODING,
    ): Promise<CryptoKey> {
        return this.importKey(
            keyEncoded,
            ECDSA_ALG,
            true,
            ['verify'],
            encoding,
        );
    }

    static async importSigningPrivateKey(
        keyEncoded: string,
        encoding: BufferEncoding = ENCODING,
    ): Promise<CryptoKey> {
        return this.importKey(keyEncoded, ECDSA_ALG, true, ['sign'], encoding);
    }

    static async importExchangePublicKey(
        keyEncoded: string,
        encoding: BufferEncoding = ENCODING,
    ): Promise<CryptoKey> {
        return this.importKey(keyEncoded, ECDH_ALG, true, [], encoding);
    }

    static async importExchangePrivateKey(
        keyEncoded: string,
        encoding: BufferEncoding = ENCODING,
    ): Promise<CryptoKey> {
        return this.importKey(
            keyEncoded,
            ECDH_ALG,
            true,
            ['deriveKey', 'deriveBits'],
            encoding,
        );
    }

    static async encodeKeyAsString(
        key: CryptoKey,
        encoding: BufferEncoding = ENCODING,
    ): Promise<string> {
        const exported = await this.exportKeySPKI(key);
        return BufferUtils.bufferToString(exported, encoding);
    }

    static async exportKeySPKI(key: CryptoKey): Promise<ArrayBuffer> {
        return this.crypto.subtle.exportKey('spki', key);
    }
}
