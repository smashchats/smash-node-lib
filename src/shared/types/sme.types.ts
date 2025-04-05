import type { IECKeyPair } from '2key-ratchet';

import { EncapsulatedIMProtoMessage } from './message.types.js';
import { sha256 } from './string.types.js';

export interface WithURL {
    url: string;
}

/**
 * https://dev.smashchats.com/messaging%20endpoints
 */
export interface SmashEndpoint extends WithURL {
    /**
     * Pre-key for use with this Endpoint
     * https://dev.smashchats.com/messaging%20endpoints
     */
    preKey: string;
    /**
     * Signature of preKey by peer's IK
     */
    signature: string;
}

/**
 * SMEv1: https://dev.smashchats.com/Smash%20Messaging%20Endpoint%20(SMEv1)
 */
interface SMEConfigBase extends WithURL {
    /**
     * SME's public key used for authentication
     */
    smePublicKey: string;
}

export interface EncryptionAlgorithm {
    name: 'AES-GCM';
    length: 256;
}

export interface SMEConfigJSON extends SMEConfigBase {
    keyAlgorithm: { name: 'ECDH'; namedCurve: 'P-256' };
    encryptionAlgorithm: { name: 'AES-GCM'; length: 256 };
    challengeEncoding: 'base64';
}

export interface SMEConfig extends SMEConfigJSON {
    preKeyPair: IECKeyPair;
}

export type SMEConfigJSONWithoutDefaults = Required<SMEConfigBase> &
    Partial<Omit<SMEConfigJSON, keyof SMEConfigBase>>;

export type SMEConfigWithoutDefaults = SMEConfigJSONWithoutDefaults &
    Pick<SMEConfig, 'preKeyPair'>;

export type MessageQueueItem = {
    message: EncapsulatedIMProtoMessage;
    size: number;
};

export type MessageQueueMap = Map<sha256, MessageQueueItem>;
