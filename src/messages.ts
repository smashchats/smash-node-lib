import {
    EncapsulatedIMProtoMessage,
    ISO8601,
    reverseDNS,
    sha256,
    undefinedString,
} from '@src/types/index.js';

export class IMEncapsulatedMessage implements EncapsulatedIMProtoMessage {
    constructor(
        public type: reverseDNS,
        public data: unknown,
        public after: sha256 | undefinedString = '',
        public timestamp: ISO8601 = new Date().toISOString() as ISO8601,
        public sha256: sha256,
    ) {}
}
