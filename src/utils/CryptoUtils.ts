import { Curve } from '2key-ratchet';
import { ENCODING } from '@src/types/index.js';
import { Logger } from '@src/utils/Logger.js';
import { Buffer } from 'buffer';

const EXPORT = 'spki';
const PK_ALG = { name: 'ECDH', namedCurve: 'P-256' };

export class CryptoUtils {
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
            this.stringToBuffer(keyEncoded, encoding),
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

    async sha256fromObject(object: unknown): Promise<string> {
        return this.sha256(this.objectToBuffer(object));
    }

    async sha256fromString(string: string): Promise<string> {
        return this.sha256(this.stringToBuffer(string));
    }

    async sha256(buffer: ArrayBuffer): Promise<string> {
        return this.bufferToString(await this.subtle.digest('SHA-256', buffer));
    }

    bufferToString(
        arrayBuffer: ArrayBuffer,
        encoding: BufferEncoding = ENCODING,
    ) {
        return Buffer.from(arrayBuffer).toString(encoding);
    }

    stringToBuffer(string: string, encoding: BufferEncoding = ENCODING) {
        return Buffer.from(string, encoding) as unknown as ArrayBuffer;
    }

    bufferToObject(arrayBuffer: ArrayBuffer) {
        return JSON.parse(this.bufferToString(arrayBuffer, 'utf8'));
    }

    objectToBuffer(object: unknown) {
        return this.stringToBuffer(JSON.stringify(object), 'utf8');
    }
}
