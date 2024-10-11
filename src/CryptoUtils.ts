import { Curve } from '2key-ratchet';
import { ENCODING } from '@src/types/index.js';

const EXPORT = 'spki';
const PK_ALG = { name: 'ECDH', namedCurve: 'P-256' };

export default class CryptoUtils {
    static setCryptoSubtle(subtle: globalThis.SubtleCrypto) {
        this.instance = new CryptoUtils(subtle);
    }

    private static instance: CryptoUtils;
    public static get singleton() {
        if (!this.instance) throw new Error('Crypto engine not initialized');
        return this.instance;
    }

    constructor(private subtle: globalThis.SubtleCrypto) {}

    get decrypt() {
        return this.subtle.decrypt;
    }

    get deriveKey() {
        return this.subtle.deriveKey;
    }

    async sign(signingKey: CryptoKey, message: ArrayBuffer) {
        return await Curve.sign(signingKey, message);
    }

    async signAsString(signingKey: CryptoKey, message: ArrayBuffer) {
        return this.bufferToString(await this.sign(signingKey, message));
    }

    async importKey(
        keyEncoded: string,
        keyAlgorithm: globalThis.KeyAlgorithm = PK_ALG,
        exportable: boolean = true,
        usages: globalThis.KeyUsage[] = [],
        encoding: BufferEncoding = ENCODING,
    ): Promise<CryptoKey> {
        return await this.subtle.importKey(
            EXPORT,
            Buffer.from(keyEncoded, encoding),
            keyAlgorithm,
            exportable,
            usages,
        );
    }

    async exportKey(key: CryptoKey): Promise<string> {
        return this.bufferToString(await this.subtle?.exportKey(EXPORT, key));
    }

    async keySha1(key: CryptoKey): Promise<string> {
        return this.sha1(await this.subtle.exportKey(EXPORT, key));
    }

    async sha1(buffer: ArrayBuffer): Promise<string> {
        return this.bufferToString(await this.subtle.digest('SHA-1', buffer));
    }

    private bufferToString(arrayBuffer: ArrayBuffer): string {
        return Buffer.from(arrayBuffer).toString(ENCODING);
    }
}
