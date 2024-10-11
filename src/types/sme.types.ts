import { IECKeyPair } from '2key-ratchet';

export interface SmashEndpoint {
    url: string;
    preKey: string;
    signature: string;
}

interface SMEConfigBase {
    url: string;
    smePublicKey: string;
}

export interface SMEConfigJSON extends SMEConfigBase {
    keyAlgorithm: KeyAlgorithm;
    encryptionAlgorithm: {
        name: string;
        length: number;
    };
    challengeEncoding: 'base64';
}

export interface SMEConfig extends SMEConfigJSON {
    preKeyPair: IECKeyPair;
}

export type SMEConfigJSONWithoutDefaults = Required<SMEConfigBase> &
    Partial<SMEConfigJSON>;

export type SMEConfigWithoutDefaults = SMEConfigJSONWithoutDefaults &
    Required<Pick<SMEConfig, 'preKeyPair'>>;

export const SME_DEFAULT_CONFIG: Omit<SMEConfigJSON, 'url' | 'smePublicKey'> = {
    keyAlgorithm: { name: 'ECDH', namedCurve: 'P-256' } as KeyAlgorithm,
    encryptionAlgorithm: { name: 'AES-GCM', length: 256 },
    challengeEncoding: 'base64' as const,
};
