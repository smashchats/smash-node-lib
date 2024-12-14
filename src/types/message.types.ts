export type ISO8601 =
    `${number}-${string}-${string}T${string}:${string}:${string}${string}${string}`;
export type reverseDNS = `${string}.${string}.${string}`;
export type sha256 = string;

/**
 * Base message interface
 *
 * @see EncapsulatedIMProtoMessage
 */
export interface BaseIMProtoMessage {
    type: reverseDNS;
    data: unknown;
    after: sha256;
}

export interface TimedIMProtoMessage extends BaseIMProtoMessage {
    timestamp: ISO8601;
}

export interface EncapsulatedIMProtoMessage extends TimedIMProtoMessage {
    sha256: sha256;
    after: sha256;
}

export type IMProtoMessage = Partial<EncapsulatedIMProtoMessage> &
    Required<BaseIMProtoMessage>;
