import { ENCODING } from '@src/shared/constants/encoding.js';
import { JsonUtils } from '@src/shared/utils/JsonUtils.js';
import { Buffer } from 'buffer';

export class BufferUtils {
    static bufferToString(
        arrayBuffer: ArrayBuffer,
        encoding: BufferEncoding = ENCODING,
    ): string {
        return Buffer.from(arrayBuffer).toString(encoding);
    }

    static stringToBuffer(
        string: string,
        encoding: BufferEncoding = ENCODING,
    ): ArrayBuffer {
        return Buffer.from(string, encoding) as unknown as ArrayBuffer;
    }

    static bufferToObject<T>(arrayBuffer: ArrayBuffer): T {
        return JsonUtils.parse<T>(this.bufferToString(arrayBuffer, 'utf8'));
    }

    static objectToBuffer(object: unknown): ArrayBuffer {
        return this.stringToBuffer(JsonUtils.stringify(object), 'utf8');
    }

    /**
     * Converts binary media content to base64 for transmission
     * @param content Raw media content
     * @returns Base64 encoded string
     */
    static mediaToBase64(content: Uint8Array): string {
        return Buffer.from(content).toString('base64');
    }

    /**
     * Converts base64 media content back to binary
     * @param base64 Base64 encoded media content
     * @returns Raw media content
     */
    static base64ToMedia(base64: string): Uint8Array {
        return new Uint8Array(Buffer.from(base64, 'base64'));
    }
}
