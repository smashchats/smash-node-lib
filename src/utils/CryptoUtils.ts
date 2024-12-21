import { Curve } from '2key-ratchet';
import {
    ENCODING,
    EncapsulatedIMProtoMessage,
    IMProtoMessage,
    ISO8601,
    SMEConfig,
    sha256,
} from '@src/types/index.js';
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
        private readonly subtle: globalThis.SubtleCrypto,
        private readonly logger: Logger = new Logger('CryptoUtils'),
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

    async keySha256(key: CryptoKey): Promise<sha256> {
        return this.sha256(await this.subtle.exportKey(EXPORT, key));
    }

    async sha256fromObject(object: unknown): Promise<sha256> {
        return this.sha256(this.objectToBuffer(object));
    }

    async sha256fromString(string: string): Promise<sha256> {
        return this.sha256(this.stringToBuffer(string));
    }

    async sha256(buffer: ArrayBuffer): Promise<sha256> {
        return this.bufferToString(
            await this.subtle.digest('SHA-256', buffer),
        ) as unknown as sha256;
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

    async solveChallenge(
        data: { iv: string; challenge: string },
        auth: SMEConfig,
    ) {
        const ivBuffer = this.stringToBuffer(data.iv, auth.challengeEncoding);
        const challengeBuffer = this.stringToBuffer(
            data.challenge,
            auth.challengeEncoding,
        );
        const smePublicKey = await this.importKey(
            auth.smePublicKey,
            auth.keyAlgorithm,
        );
        const symmetricKey = await this.deriveKey(
            {
                ...auth.keyAlgorithm,
                public: smePublicKey,
            } as KeyAlgorithm,
            auth.preKeyPair.privateKey,
            auth.encryptionAlgorithm,
            false,
            ['encrypt', 'decrypt'],
        );
        const unencryptedChallenge = await this.decrypt(
            {
                ...auth.encryptionAlgorithm,
                iv: ivBuffer,
            } as KeyAlgorithm,
            symmetricKey,
            challengeBuffer,
        );
        return this.bufferToString(
            unencryptedChallenge,
            auth.challengeEncoding,
        );
    }

    async encapsulateMessage(
        message: IMProtoMessage,
    ): Promise<EncapsulatedIMProtoMessage> {
        const timestamp = new Date().toISOString() as ISO8601;
        const sha256 = await this.sha256fromObject({
            ...message,
            timestamp,
        });
        return { ...message, sha256, timestamp };
    }
}
