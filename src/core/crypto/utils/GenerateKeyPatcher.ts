import type {
    IRestrictedCryptoEngine,
    IRestrictedSubtleCrypto,
} from '@src/core/crypto/engine/CryptoEngine.js';
import { CryptoManager } from '@src/core/crypto/engine/CryptoManager.js';
import type {
    IIMPeerIdentity,
    IJWKJson,
    IJWKJsonKeyPair,
} from '@src/shared/types/identity.types.js';

export class GenerateKeyPatcher extends CryptoManager {
    private static readonly jwkMap = new WeakMap<CryptoKey, JsonWebKey>();
    private static patchedGenerateKey?: IRestrictedCryptoEngine;

    public static patch() {
        const c = this.crypto;
        if (this.patchedGenerateKey === c) {
            return;
        }
        const originalGenerateKey = c.subtle.generateKey;
        c.subtle.generateKey = async function (
            this: IRestrictedSubtleCrypto,
            ...args: Parameters<typeof originalGenerateKey>
        ): ReturnType<typeof originalGenerateKey> {
            const keyPairOrSingleKey = await originalGenerateKey.apply(
                this,
                args,
            );
            const attachJwk = async (key: CryptoKey) => {
                if (!key.extractable) return;
                const jwk = await c.subtle.exportKey('jwk', key);
                GenerateKeyPatcher.jwkMap.set(key, jwk);
            };
            if ('privateKey' in keyPairOrSingleKey) {
                await attachJwk(keyPairOrSingleKey.privateKey);
                await attachJwk(keyPairOrSingleKey.publicKey);
            } else {
                await attachJwk(keyPairOrSingleKey);
            }
            return keyPairOrSingleKey;
        } as typeof c.subtle.generateKey;
        this.patchedGenerateKey = c;
    }

    private static async reconstituteCryptoKey(
        key: IJWKJson,
    ): Promise<CryptoKey> {
        if (!key.jwk) return key as CryptoKey;
        const cryptoKey = await this.crypto.subtle.importKey(
            'jwk',
            key.jwk,
            key.algorithm as { name: 'ECDSA' | 'ECDH'; namedCurve: 'P-256' },
            true,
            key.usages as ReadonlyArray<'verify' | 'deriveKey' | 'deriveBits'>,
        );
        this.jwkMap.set(cryptoKey, key.jwk);
        return cryptoKey;
    }

    private static async reconstituteKeyPair(
        keyPair: IJWKJsonKeyPair,
    ): Promise<IJWKJsonKeyPair> {
        return {
            privateKey: await this.reconstituteCryptoKey(keyPair.privateKey),
            publicKey: await this.reconstituteCryptoKey(keyPair.publicKey),
            thumbprint: keyPair.thumbprint,
        };
    }

    public static async reconstituteKeys(
        identityJSON: IIMPeerIdentity,
    ): Promise<IIMPeerIdentity> {
        return {
            ...identityJSON,
            signingKey: await this.reconstituteKeyPair(identityJSON.signingKey),
            exchangeKey: await this.reconstituteKeyPair(
                identityJSON.exchangeKey,
            ),
            preKeys: await Promise.all(
                identityJSON.preKeys.map(this.reconstituteKeyPair.bind(this)),
            ),
            signedPreKeys: await Promise.all(
                identityJSON.signedPreKeys.map(
                    this.reconstituteKeyPair.bind(this),
                ),
            ),
        };
    }

    public static jsonStringifyReplacer = this.jsonStringifyReplace.bind(this);

    private static jsonStringifyReplace(_key: string, value: unknown) {
        if (typeof value === 'object' && value && 'algorithm' in value) {
            const key = value as CryptoKey;
            const jwk = this.jwkMap.get(key);
            if (jwk) {
                return {
                    jwk,
                    algorithm: key.algorithm,
                    usages: key.usages,
                    extractable: key.extractable,
                    type: key.type,
                };
            }
        }
        return value;
    }
}
