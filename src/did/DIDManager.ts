import type { IMPeerIdentity } from '@src/IMPeerIdentity.js';
import type { DIDDocument, DIDMethod, DIDString } from '@src/types/index.js';
import type { DID } from '@src/types/index.js';

export abstract class DIDManager {
    abstract generate(): Promise<IMPeerIdentity>;
    abstract resolve(did: DID): Promise<DIDDocument>;
    static parseMethod(did: DIDString): DIDMethod {
        return did.split(':')[1] as DIDMethod;
    }
}
