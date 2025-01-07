import { setEngine } from '2key-ratchet';
import { IRestrictedCryptoEngine } from '@src/core/crypto/engine/CryptoEngine.js';

export class CryptoManager {
    protected static crypto: IRestrictedCryptoEngine;

    static setCrypto(c: IRestrictedCryptoEngine) {
        setEngine('@peculiar/webcrypto', c as globalThis.Crypto);
        this.crypto = c;
    }
}
