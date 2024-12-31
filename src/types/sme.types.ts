import { IECKeyPair } from '@src/types/index.js';

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
    name: string;
    length: number;
}

export interface SMEConfigJSON extends SMEConfigBase {
    keyAlgorithm: KeyAlgorithm;
    encryptionAlgorithm: EncryptionAlgorithm;
    challengeEncoding: 'base64';
}

export interface SMEConfig extends SMEConfigJSON {
    preKeyPair: IECKeyPair;
}

export type SMEConfigJSONWithoutDefaults = Required<SMEConfigBase> &
    Partial<Omit<SMEConfigJSON, keyof SMEConfigBase>>;

export type SMEConfigWithoutDefaults = SMEConfigJSONWithoutDefaults &
    Pick<SMEConfig, 'preKeyPair'>;
