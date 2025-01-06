import { CryptoManager } from '@src/core/crypto/engine/CryptoManager.js';
import { BufferUtils } from '@src/core/crypto/utils/BufferUtils.js';
import { KeyUtils } from '@src/core/crypto/utils/KeyUtils.js';
import type { sha256 } from '@src/shared/types/string.types.js';

export class HashUtils extends CryptoManager {
    static async sha256FromKey(key: CryptoKey): Promise<sha256> {
        return this.sha256(await KeyUtils.exportKeySPKI(key));
    }

    static async sha256fromObject(object: unknown): Promise<sha256> {
        return this.sha256(BufferUtils.objectToBuffer(object));
    }

    static async sha256fromString(string: string): Promise<sha256> {
        return this.sha256(BufferUtils.stringToBuffer(string));
    }

    static async sha256(buffer: ArrayBuffer): Promise<sha256> {
        return BufferUtils.bufferToString(
            await this.crypto.subtle.digest('SHA-256', buffer),
        ) as unknown as sha256;
    }
}
