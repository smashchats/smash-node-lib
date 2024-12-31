import { setEngine } from '2key-ratchet';
import { CryptoUtils } from '@src/utils/CryptoUtils.js';

export class CryptoManager {
    protected static crypto: globalThis.Crypto;

    static setCrypto(c: globalThis.Crypto) {
        setEngine('@peculiar/webcrypto', c);
        // TODO: split utils class / refactor
        CryptoUtils.setCryptoSubtle(c.subtle);
        this.crypto = c;
    }
}
