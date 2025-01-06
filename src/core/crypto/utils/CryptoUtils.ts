import { CryptoManager } from '@src/core/crypto/engine/CryptoManager.js';

export class CryptoUtils extends CryptoManager {
    static get decrypt() {
        return this.crypto.subtle.decrypt.bind(this.crypto.subtle);
    }

    static get deriveKey() {
        return this.crypto.subtle.deriveKey.bind(this.crypto.subtle);
    }
}
