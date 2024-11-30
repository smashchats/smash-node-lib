import { Curve } from '2key-ratchet';
import { Logger } from '@src/Logger.js';
import { ENCODING } from '@src/types/index.js';
import { Buffer } from 'buffer';

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

    constructor(
        private subtle: globalThis.SubtleCrypto,
        private logger: Logger = new Logger('CryptoUtils'),
    ) {}

    get decrypt() {
        return this.subtle.decrypt.bind(this.subtle);
    }

    get deriveKey() {
        return this.subtle.deriveKey.bind(this.subtle);
    }

    async sign(signingKey: CryptoKey, message: ArrayBuffer) {
        try {
            return await Curve.sign(signingKey, message);
        } catch (err) {
            this.logger.error('Cannot sign message.');
            throw err;
        }
    }

    async signAsString(signingKey: CryptoKey, message: ArrayBuffer) {
        return this.bufferToString(await this.sign(signingKey, message));
    }

    async importKey(
        keyEncoded: string,
        keyAlgorithm: KeyAlgorithm = PK_ALG,
        exportable: boolean = true,
        usages: KeyUsage[] = [],
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

    async keySha256(key: CryptoKey): Promise<string> {
        return this.sha256(await this.subtle.exportKey(EXPORT, key));
    }

    async sha256(buffer: ArrayBuffer): Promise<string> {
        return this.bufferToString(await this.subtle.digest('SHA-256', buffer));
    }

    private bufferToString(arrayBuffer: ArrayBuffer): string {
        return Buffer.from(arrayBuffer).toString(ENCODING);
    }
}
