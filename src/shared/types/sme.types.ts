import type { IECKeyPair } from '2key-ratchet';

interface WithURL {
    url: string;
}

export interface SmashEndpoint extends WithURL {
    preKey: string;
    signature: string;
}

interface SMEConfigBase extends WithURL {
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
