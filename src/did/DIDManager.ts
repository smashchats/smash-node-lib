import type { IMPeerIdentity } from '@src/IMPeerIdentity.js';
import type {
    DID,
    DIDDocument,
    DIDMethod,
    DIDString,
    IECKeyPair,
} from '@src/types/index.js';

export abstract class DIDManager {
    private static readonly didDocManagers = new Map<DIDMethod, DIDManager>();

    abstract resolve(did: DID): Promise<DIDDocument>;
    abstract generate(): Promise<IMPeerIdentity>;
    abstract generateNewPreKeyPair(
        identity: IMPeerIdentity,
    ): Promise<IECKeyPair>;

    static parseMethod(did: DIDString): DIDMethod {
        return did.split(':')[1] as DIDMethod;
    }

    static use(method: DIDMethod, manager: DIDManager): void {
        this.didDocManagers.set(method, manager);
    }

    static get(method: DIDMethod): DIDManager | undefined {
        return this.didDocManagers.get(method);
    }

    static async resolve(did: DID): Promise<DIDDocument> {
        const didString = typeof did === 'string' ? did : did.id;
        const method = this.parseMethod(didString);
        const resolver = this.didDocManagers.get(method);

        if (!resolver) {
            throw new Error(`No resolver found for ${didString}`);
        }

        return resolver.resolve(didString);
    }
}
