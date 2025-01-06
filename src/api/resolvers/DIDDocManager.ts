import { Curve, IECKeyPair } from '2key-ratchet';
import { BufferUtils } from '@src/core/crypto/utils/BufferUtils.js';
import { KeyUtils } from '@src/core/crypto/utils/KeyUtils.js';
import { IMPeerIdentity } from '@src/core/identity/IMPeerIdentity.js';
import { DID } from '@src/shared/types/did.types.js';
import type {
    DIDDocument,
    DIDMethod,
    DIDString,
    IDIDResolver,
} from '@src/shared/types/index.js';

/**
 * Implementation of the IDIDResolver interface for a dummy 'doc' did method.
 * The 'doc' method only works when the full DID document is passed to the resolve method.
 * There is a caching mechanism to allow further resolutions of the same DID document.
 *
 * @public SmashMessaging.use('doc', new DIDDocManager())
 */
export class DIDDocManager implements IDIDResolver {
    public readonly method: DIDMethod = 'doc';
    private readonly cache: Map<DIDString, DIDDocument> = new Map();

    resolve(did: DID): Promise<DIDDocument> {
        if (typeof did === 'string') {
            const cached = this.cache.get(did);
            if (cached) return Promise.resolve(cached);
            return Promise.reject(
                new Error(`DID resolver not implemented for (${did})`),
            );
        }
        this.set(did as DIDDocument);
        return Promise.resolve(did);
    }

    public async generate(exportable: boolean = true): Promise<IMPeerIdentity> {
        const [ik, ek] = await Promise.all([
            IMPeerIdentity.generateIdentityKeys(exportable),
            IMPeerIdentity.generateExchangeKeys(exportable),
        ]);
        const thumbprint = await ik.publicKey.thumbprint();
        const did = `did:doc:${thumbprint}` as const;
        const signatureBuf = await Curve.sign(
            ik.privateKey,
            ek.publicKey.serialize(),
        );
        const signature = BufferUtils.bufferToString(signatureBuf);
        const didDocument: DIDDocument = {
            id: did,
            ik: await KeyUtils.encodeKeyAsString(ik.publicKey.key),
            ek: await KeyUtils.encodeKeyAsString(ek.publicKey.key),
            signature,
            endpoints: [],
        };
        this.set(JSON.parse(JSON.stringify(didDocument)));
        const newIdentity = new IMPeerIdentity(did, ik, ek);
        return newIdentity;
    }

    public async generateNewPreKeyPair(
        identity: IMPeerIdentity,
        exportable: boolean = true,
    ): Promise<IECKeyPair> {
        const preKeyPair =
            await IMPeerIdentity.generateExchangeKeys(exportable);
        identity.addPreKeyPair(preKeyPair);
        return preKeyPair;
    }

    set(didDocument: DIDDocument) {
        this.cache.set(didDocument.id, didDocument);
    }
}
