// the 2key-ratchet library implementing the Signal protocol requires a
// crypto engine exposing a WebCrypto standard interface.
// of this interface, the version currently imported ("^1.0.18") makes use of:
// - `crypto.getRandomValues(array: Uint8Array): Uint8Array`
// - `crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, extractable: boolean, ["sign", "verify"]);`
// - `crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, extractable: boolean, ["deriveKey", "deriveBits"]);`
// - `crypto.subtle.deriveBits({ name: "ECDH", public: CryptoKey }, privateKey: CryptoKey, 256);`
// - `crypto.subtle.sign({ name: "ECDSA", hash: "SHA-512" }, signingKey: CryptoKey, message: ArrayBuffer);`
// - `crypto.subtle.sign({ name: "HMAC", hash: "SHA-256" }, signingKey: CryptoKey, message: ArrayBuffer);`
// - `crypto.subtle.verify({ name: "ECDSA", hash: "SHA-512" }, signingKey: CryptoKey, signature: ArrayBuffer, message: ArrayBuffer);`
// - `crypto.subtle.exportKey("jwk", publicKey: CryptoKey);`
// - `crypto.subtle.importKey("jwk", jwk: JsonWebKey, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);`
// - `crypto.subtle.importKey("jwk", jwk: JsonWebKey, { name: "ECDH", namedCurve: "P-256" }, true, []);`
// - `crypto.subtle.importKey("raw", raw: ArrayBuffer, { name: "AES-CBC", length: 256 }, false, ["encrypt", "decrypt"]);`
// - `crypto.subtle.importKey("raw", raw: ArrayBuffer, { name: "HMAC", hash: { name: "SHA-256" } }, false, ["sign", "verify"]);`
// - `crypto.subtle.decrypt({ name: "AES-CBC", iv: Uint8Array }, key: CryptoKey, data: ArrayBuffer);`
// - `crypto.subtle.encrypt({ name: "AES-CBC", iv: Uint8Array }, key: CryptoKey, data: ArrayBuffer);`
// - `crypto.subtle.digest(alg: string, message: ArrayBuffer);`
// source: https://github.com/PeculiarVentures/2key-ratchet/blob/master/dist/types/crypto/crypto.d.ts

// In addition, our own library makes use of:
// - `crypto.subtle.importKey('jwk', key: JsonWebKey, algorithm: KeyAlgorithm, true, usages: KeyUsage[]);`
// - `crypto.subtle.digest('SHA-256', buffer: ArrayBuffer);`
// - `crypto.subtle.exportKey('spki', key: CryptoKey);`
// - `crypto.subtle.importKey('spki', key: ArrayBuffer, algorithm: KeyAlgorithm, true, usages: KeyUsage[]);`
// - `crypto.subtle.deriveKey(keyAlgorithm: KeyAlgorithm, baseKey: CryptoKey, derivedKeyType: KeyAlgorithm, extractable: boolean, keyUsages: KeyUsage[]);`
// - `crypto.subtle.decrypt({name: 'AES-GCM', length: 256, iv: Uint8Array }, key: CryptoKey, data: ArrayBuffer);`

export interface IRestrictedCryptoEngine {
    readonly subtle: IRestrictedSubtleCrypto;
    getRandomValues<T extends ArrayBufferView | null>(array: T): T;
}

export interface IRestrictedSubtleCrypto {
    // ECDSA operations
    generateKey(
        algorithm: { name: 'ECDSA'; namedCurve: 'P-256' },
        extractable: boolean,
        keyUsages: ReadonlyArray<'sign' | 'verify'>,
    ): Promise<CryptoKeyPair>;

    sign(
        algorithm: { name: 'ECDSA'; hash: 'SHA-512' },
        key: CryptoKey,
        data: BufferSource,
    ): Promise<ArrayBuffer>;

    verify(
        algorithm: { name: 'ECDSA'; hash: 'SHA-512' },
        key: CryptoKey,
        signature: BufferSource,
        data: BufferSource,
    ): Promise<boolean>;

    // ECDH operations
    generateKey(
        algorithm: { name: 'ECDH'; namedCurve: 'P-256' },
        extractable: boolean,
        keyUsages: ReadonlyArray<'deriveKey' | 'deriveBits'>,
    ): Promise<CryptoKeyPair>;

    deriveBits(
        algorithm: { name: 'ECDH'; public: CryptoKey },
        privateKey: CryptoKey,
        length: 256,
    ): Promise<ArrayBuffer>;

    // HMAC operations
    sign(
        algorithm: { name: 'HMAC'; hash: 'SHA-256' },
        key: CryptoKey,
        data: BufferSource,
    ): Promise<ArrayBuffer>;

    // Key import/export
    exportKey(format: 'jwk', key: CryptoKey): Promise<JsonWebKey>;
    exportKey(format: 'spki', key: CryptoKey): Promise<ArrayBuffer>;

    importKey(
        format: 'jwk',
        keyData: JsonWebKey,
        algorithm: { name: 'ECDSA' | 'ECDH'; namedCurve: 'P-256' },
        extractable: boolean,
        keyUsages: ReadonlyArray<'verify' | 'deriveKey' | 'deriveBits'>,
    ): Promise<CryptoKey>;

    importKey(
        format: 'spki',
        keyData: BufferSource,
        algorithm: KeyAlgorithm,
        extractable: boolean,
        keyUsages: KeyUsage[],
    ): Promise<CryptoKey>;

    importKey(
        format: 'raw',
        keyData: BufferSource,
        algorithm:
            | { name: 'AES-CBC'; length: 256 }
            | { name: 'HMAC'; hash: { name: 'SHA-256' } },
        extractable: boolean,
        keyUsages: ReadonlyArray<'encrypt' | 'decrypt' | 'sign' | 'verify'>,
    ): Promise<CryptoKey>;

    // AES operations
    decrypt(
        algorithm: { name: 'AES-CBC' | 'AES-GCM'; iv: Uint8Array },
        key: CryptoKey,
        data: BufferSource,
    ): Promise<ArrayBuffer>;

    encrypt(
        algorithm: { name: 'AES-CBC'; iv: Uint8Array },
        key: CryptoKey,
        data: BufferSource,
    ): Promise<ArrayBuffer>;

    // Key derivation
    deriveKey(
        algorithm: KeyAlgorithm & { public: CryptoKey },
        baseKey: CryptoKey,
        derivedKeyType: { name: 'AES-GCM'; length: 256 },
        extractable: boolean,
        keyUsages: KeyUsage[],
    ): Promise<CryptoKey>;

    // Hashing
    digest(algorithm: 'SHA-256', data: BufferSource): Promise<ArrayBuffer>;
}
