import type {
    DID,
    DIDDocument,
    DIDMethod,
    DIDString,
    IDIDResolver,
} from '@src/shared/types/did.types.js';

export class DIDManager {
    private static readonly didDocManagers = new Map<DIDMethod, IDIDResolver>();

    static parseMethod(did: DIDString): DIDMethod {
        return did.split(':')[1] as DIDMethod;
    }

    static use(method: DIDMethod, manager: IDIDResolver): void {
        this.didDocManagers.set(method, manager);
    }

    static get(method: DIDMethod): IDIDResolver | undefined {
        return this.didDocManagers.get(method);
    }

    /**
     * Resolve a DID to its DID Document using the registered resolver (if any)
     * @param did - The DID to resolve
     * @returns The resolved DID Document
     * @throws Error if no resolver is found for the DID method
     */
    static async resolve(did: DID): Promise<DIDDocument> {
        const didString = typeof did === 'string' ? did : did.id;
        const method = this.parseMethod(didString);
        const resolver = this.didDocManagers.get(method);
        if (!resolver) {
            throw new Error(`No resolver found for ${didString}`);
        }
        return resolver.resolve(did);
    }
}
