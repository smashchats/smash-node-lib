import type { IECKeyPair } from '2key-ratchet';
import { Curve, Identity } from '2key-ratchet';
import type { ECKeyType } from '2key-ratchet/dist/types/type.js';
import { SmashMessaging } from '@src/SmashMessaging.js';
import { GenerateKeyPatcher } from '@src/crypto/utils/GenerateKeyPatcher.js';
import type {
    DIDDocument,
    DIDString,
    IIMPeerIdentity,
    IJWKJsonKeyPair,
    SmashEndpoint,
} from '@src/types/index.js';
import type { Logger } from '@src/utils/Logger.js';

const SIGN_ALGORITHM_NAME = 'ECDSA';
const DH_ALGORITHM_NAME = 'ECDH';

export class IMPeerIdentity extends Identity {
    constructor(
        public readonly did: DIDString,
        signingKey: IECKeyPair,
        exchangeKey: IECKeyPair,
        private readonly endpoints: SmashEndpoint[] = [],
    ) {
        super(0, signingKey, exchangeKey);
    }

    pushEndpoint(endpoint: SmashEndpoint) {
        this.removeEndpointIfExists(endpoint);
        this.endpoints.push({ ...endpoint });
    }

    removeEndpointIfExists({ url, preKey }: SmashEndpoint) {
        const index = this.endpoints.findIndex(
            (e) => e.url === url && e.preKey === preKey,
        );
        if (index !== -1) {
            this.endpoints.splice(index, 1);
        }
    }

    static async generateIdentityKeys(extractable: boolean = false) {
        return this.generateKeyPair(SIGN_ALGORITHM_NAME, extractable);
    }

    static async generateExchangeKeys(extractable: boolean = false) {
        return this.generateKeyPair(DH_ALGORITHM_NAME, extractable);
    }

    private static async generateKeyPair(
        type: ECKeyType,
        extractable: boolean = false,
    ) {
        GenerateKeyPatcher.patch();
        return Curve.generateKeyPair(type, extractable);
    }

    static async deserialize(
        serializedIdentity: string,
        ecKeyPairFromJson?: (keys: IJWKJsonKeyPair) => Promise<IECKeyPair>,
        logger?: Logger,
    ): Promise<IMPeerIdentity> {
        try {
            const identityJSON = JSON.parse(
                serializedIdentity,
            ) as IIMPeerIdentity;
            if (ecKeyPairFromJson) Curve.ecKeyPairFromJson = ecKeyPairFromJson;
            return this.fromJSON(
                await GenerateKeyPatcher.reconstituteKeys(identityJSON),
            );
        } catch (err) {
            logger?.error('Cannot parse identity json.');
            throw err;
        }
    }

    static async fromJSON(json: IIMPeerIdentity): Promise<IMPeerIdentity> {
        const [signingKey, exchangeKey] = await Promise.all([
            Curve.ecKeyPairFromJson(json.signingKey),
            Curve.ecKeyPairFromJson(json.exchangeKey),
        ]);
        const res = new this(json.did, signingKey, exchangeKey);
        res.id = json.id;
        res.createdAt = new Date(json.createdAt);
        [res.preKeys, res.signedPreKeys] = await Promise.all([
            Promise.all(
                json.preKeys.map((key) => Curve.ecKeyPairFromJson(key)),
            ),
            Promise.all(
                json.signedPreKeys.map((key) => Curve.ecKeyPairFromJson(key)),
            ),
        ]);
        return res;
    }

    async toJSON(): Promise<IIMPeerIdentity> {
        if (!this.createdAt) this.createdAt = new Date();
        return super.toJSON().then((json) => ({
            ...json,
            did: this.did,
            endpoints: this.endpoints,
        }));
    }

    async serialize(): Promise<string> {
        return this.toJSON().then((json) =>
            JSON.stringify(json, GenerateKeyPatcher.jsonStringifyReplacer),
        );
    }

    async getDIDDocument(): Promise<DIDDocument> {
        const doc = await SmashMessaging.resolve(this.did);
        if (!doc) throw new Error(`Could not resolve (${this.did}) for export`);
        // adding local endpoints on top of the resolved DID document
        const localEndpoints = this.endpoints.filter((endpoint) => {
            return !doc.endpoints.some(
                (docEndpoint) =>
                    docEndpoint.url === endpoint.url &&
                    docEndpoint.preKey === endpoint.preKey,
            );
        });
        doc.endpoints.push(...localEndpoints);
        return doc;
    }

    async generateNewPreKeyPair() {
        const preKeyPair = await IMPeerIdentity.generateExchangeKeys();
        this.signedPreKeys.push(preKeyPair);
        return preKeyPair;
    }
}
