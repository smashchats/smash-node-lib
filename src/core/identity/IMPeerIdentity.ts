import type { IECKeyPair } from '2key-ratchet';
import { Curve, Identity } from '2key-ratchet';
import type { ECKeyType } from '2key-ratchet/dist/types/type.js';
import { GenerateKeyPatcher } from '@src/core/crypto/utils/GenerateKeyPatcher.js';
import { KeyUtils } from '@src/core/crypto/utils/KeyUtils.js';
import { SigningUtils } from '@src/core/crypto/utils/SigningUtils.js';
import type { DIDDocument, DIDString } from '@src/shared/types/did.types.js';
import type {
    IIMPeerIdentity,
    IJWKJsonKeyPair,
} from '@src/shared/types/identity.types.js';
import type { SmashEndpoint } from '@src/shared/types/sme.types.js';
import type { Logger } from '@src/shared/utils/Logger.js';

const ALGORITHMS = {
    SIGNING: 'ECDSA' as const,
    EXCHANGE: 'ECDH' as const,
} as const;

export class IMPeerIdentity extends Identity {
    private readonly endpoints: SmashEndpoint[];

    constructor(
        public readonly did: DIDString,
        signingKey: IECKeyPair,
        exchangeKey: IECKeyPair,
        endpoints: SmashEndpoint[] = [],
    ) {
        super(0, signingKey, exchangeKey);
        this.endpoints = [...endpoints];
    }

    // Endpoint Management
    public getEndpoints(): SmashEndpoint[] {
        return [...this.endpoints];
    }

    public addEndpoint(endpoint: SmashEndpoint): void {
        this.removeEndpoint(endpoint);
        this.endpoints.push({ ...endpoint });
    }

    public removeEndpoint(endpoint: SmashEndpoint): void {
        const index = this.findEndpointIndex(endpoint);
        if (index !== -1) {
            this.endpoints.splice(index, 1);
        }
    }

    private findEndpointIndex({ url, preKey }: SmashEndpoint): number {
        return this.endpoints.findIndex(
            (e) => e.url === url && e.preKey === preKey,
        );
    }

    // Key Management
    public addPreKeyPair(preKeyPair: IECKeyPair): void {
        this.signedPreKeys.push(preKeyPair);
    }

    public static async generateIdentityKeys(
        extractable = false,
    ): Promise<IECKeyPair> {
        return this.generateKeyPair(ALGORITHMS.SIGNING, extractable);
    }

    public static async generateExchangeKeys(
        extractable = false,
    ): Promise<IECKeyPair> {
        return this.generateKeyPair(ALGORITHMS.EXCHANGE, extractable);
    }

    private static async generateKeyPair(
        type: ECKeyType,
        extractable = false,
    ): Promise<IECKeyPair> {
        GenerateKeyPatcher.patch();
        return Curve.generateKeyPair(type, extractable);
    }

    // Serialization & Deserialization
    public static async deserialize(
        identityJSON: IIMPeerIdentity,
        ecKeyPairFromJson?: (keys: IJWKJsonKeyPair) => Promise<IECKeyPair>,
        logger?: Logger,
    ): Promise<IMPeerIdentity> {
        try {
            if (ecKeyPairFromJson) {
                Curve.ecKeyPairFromJson = ecKeyPairFromJson;
            }
            const reconstitutedIdentity =
                await GenerateKeyPatcher.reconstituteKeys(identityJSON);
            return this.fromJSON(reconstitutedIdentity);
        } catch (err) {
            logger?.error('Cannot parse identity json.');
            throw err;
        }
    }

    public static async fromJSON(
        json: IIMPeerIdentity,
    ): Promise<IMPeerIdentity> {
        const [signingKey, exchangeKey] = await Promise.all([
            Curve.ecKeyPairFromJson(json.signingKey),
            Curve.ecKeyPairFromJson(json.exchangeKey),
        ]);

        const identity = new this(json.did, signingKey, exchangeKey);
        await identity.initializeFromJSON(json);
        return identity;
    }

    private async initializeFromJSON(json: IIMPeerIdentity): Promise<void> {
        this.id = json.id;
        this.createdAt = new Date(json.createdAt);
        const preKeys = json.preKeys;
        const signedPreKeys = json.signedPreKeys;
        [this.preKeys, this.signedPreKeys] = await Promise.all([
            Promise.all(preKeys.map(Curve.ecKeyPairFromJson.bind(Curve))),
            Promise.all(signedPreKeys.map(Curve.ecKeyPairFromJson.bind(Curve))),
        ]);
    }

    public async toJSON(): Promise<IIMPeerIdentity> {
        this.createdAt ??= new Date();
        const baseJSON = await super.toJSON();
        return {
            ...baseJSON,
            did: this.did,
            endpoints: this.endpoints,
        };
    }

    public async serialize(): Promise<IIMPeerIdentity> {
        const json = await this.toJSON();
        return JSON.parse(
            JSON.stringify(json, GenerateKeyPatcher.jsonStringifyReplacer),
        );
    }

    public async getDIDDocument(): Promise<DIDDocument> {
        // TODO?
        // const doc = await DIDManager.resolve(this.did);
        // if (!doc) {
        //     throw new Error(`Could not resolve DID document for ${this.did}`);
        // }
        // this.mergeEndpointsIntoDocument(doc);
        // return doc;
        const encode = (key: IECKeyPair) =>
            KeyUtils.encodeKeyAsString(key.publicKey.key);
        return {
            id: this.did,
            ik: await encode(this.signingKey),
            ek: await encode(this.exchangeKey),
            signature: await SigningUtils.signAsString(
                this.signingKey.privateKey,
                this.exchangeKey.publicKey.serialize(),
            ),
            endpoints: this.endpoints,
        };
    }

    private mergeEndpointsIntoDocument(doc: DIDDocument): void {
        const newEndpoints = this.endpoints.filter(
            (endpoint) => !this.isEndpointInDocument(endpoint, doc),
        );
        doc.endpoints.push(...newEndpoints);
    }

    private isEndpointInDocument(
        endpoint: SmashEndpoint,
        doc: DIDDocument,
    ): boolean {
        return doc.endpoints.some(
            (docEndpoint) =>
                docEndpoint.url === endpoint.url &&
                docEndpoint.preKey === endpoint.preKey,
        );
    }
}
