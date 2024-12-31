import { Curve } from '2key-ratchet';
import { IMPeerIdentity } from '@src/IMPeerIdentity.js';
import { DIDManager } from '@src/did/DIDManager.js';
import { DID, DIDDocument, DIDString } from '@src/types/index.js';
import { CryptoUtils } from '@src/utils/CryptoUtils.js';

export class DIDDocManager extends DIDManager {
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

    async generate(): Promise<[DIDDocument, IMPeerIdentity]> {
        const cryptoSingleton = CryptoUtils.singleton;
        const [ik, ek] = await Promise.all([
            IMPeerIdentity.generateIdentityKeys(),
            IMPeerIdentity.generateExchangeKeys(),
        ]);
        const thumbprint = await ik.publicKey.thumbprint();
        const did = `did:doc:${thumbprint}` as const;
        const signatureBuf = await Curve.sign(
            ik.privateKey,
            ek.publicKey.serialize(),
        );
        const signature = cryptoSingleton.bufferToString(signatureBuf);
        const didDocument: DIDDocument = {
            id: did,
            ik: await cryptoSingleton.exportKey(ik.publicKey.key),
            ek: await cryptoSingleton.exportKey(ek.publicKey.key),
            signature,
            endpoints: [],
        };
        this.set(didDocument);
        return [didDocument, new IMPeerIdentity(did, ik, ek)];
    }

    set(didDocument: DIDDocument) {
        this.cache.set(didDocument.id, didDocument);
    }
}
