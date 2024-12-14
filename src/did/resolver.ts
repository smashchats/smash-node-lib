import { DID, DIDDocument } from '@src/types/index.js';

export class DIDResolver {
    static async resolve(did: DID): Promise<DIDDocument> {
        if (typeof did === 'string') {
            throw new Error('DID resolver not implemented yet!');
        }
        return did;
    }
}
