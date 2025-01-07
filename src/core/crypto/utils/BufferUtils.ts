import { ENCODING } from '@src/shared/constants/encoding.js';
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
        return JSON.parse(this.bufferToString(arrayBuffer, 'utf8'));
    }

    static objectToBuffer(object: unknown): ArrayBuffer {
        return this.stringToBuffer(JSON.stringify(object), 'utf8');
    }
}
