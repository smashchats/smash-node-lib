import type { IMPeerIdentity } from '@src/IMPeerIdentity.js';
import type {
    DID,
    DIDDocument,
    DIDMethod,
    DIDString,
    IECKeyPair,
} from '@src/types/index.js';

export abstract class DIDManager {
    abstract resolve(did: DID): Promise<DIDDocument>;
    abstract generate(): Promise<IMPeerIdentity>;
    abstract generateNewPreKeyPair(
        identity: IMPeerIdentity,
    ): Promise<IECKeyPair>;
    static parseMethod(did: DIDString): DIDMethod {
        return did.split(':')[1] as DIDMethod;
    }
}
