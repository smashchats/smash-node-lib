import type {
    ISO8601,
    reverseDNS,
    sha256,
    undefinedString,
} from '@src/shared/types/string.types.js';

/**
 * Base message interface
 *
 * @see EncapsulatedIMProtoMessage
 */
export interface BaseIMProtoMessage {
    type: reverseDNS;
    data: unknown;
    after: sha256 | undefinedString;
}

interface TimedIMProtoMessage extends BaseIMProtoMessage {
    timestamp: ISO8601;
}

export interface EncapsulatedIMProtoMessage extends TimedIMProtoMessage {
    sha256: sha256;
}

export interface EncapsulatedWithSize extends EncapsulatedIMProtoMessage {
    size?: number;
}

export type IMProtoMessage = Partial<EncapsulatedIMProtoMessage> &
    Required<BaseIMProtoMessage>;
