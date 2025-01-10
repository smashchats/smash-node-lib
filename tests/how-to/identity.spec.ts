import { Crypto } from '@peculiar/webcrypto';
import { DIDDocManager, IMPeerIdentity, SmashMessaging } from 'smash-node-lib';

describe('DIDManager: Identity Management', () => {
    let didManager: DIDDocManager;

    beforeAll(() => {
        SmashMessaging.setCrypto(new Crypto());
    });

    beforeEach(() => {
        didManager = new DIDDocManager();
    });

    describe('generate', () => {
        it('generates an identity with default parameters', async () => {
            const identity = await didManager.generate();
            expect(identity.did).toMatch(/^did:doc:/);

            const didDoc = await didManager.resolve(identity.did);
            expect(didDoc).toMatchObject({
                id: identity.did,
                ik: expect.any(String),
                ek: expect.any(String),
                signature: expect.any(String),
                endpoints: expect.any(Array),
            });
        });

        it('generates extractable keys when specified (default depends on Manager instance)', async () => {
            const identity = await didManager.generate(true);

            expect(identity.signingKey.privateKey.extractable).toBe(true);
            expect(identity.signingKey.publicKey.key.extractable).toBe(true);
            expect(identity.exchangeKey.privateKey.extractable).toBe(true);
            expect(identity.exchangeKey.publicKey.key.extractable).toBe(true);
        });

        it('generates non-extractable keys when specified (default depends on Manager instance)', async () => {
            const identity = await didManager.generate(false);

            expect(identity.signingKey.privateKey.extractable).toBe(false);
            expect(identity.signingKey.publicKey.key.extractable).toBe(true);
            expect(identity.exchangeKey.privateKey.extractable).toBe(false);
            expect(identity.exchangeKey.publicKey.key.extractable).toBe(true);
        });
    });

    describe('generateNewPreKeyPair', () => {
        let identity: IMPeerIdentity;

        beforeEach(async () => {
            identity = await didManager.generate();
        });

        it('generates new pre-key pair for existing identity', async () => {
            const preKeyPair = await didManager.generateNewPreKeyPair(identity);

            expect(preKeyPair.privateKey).toBeDefined();
            expect(preKeyPair.publicKey).toBeDefined();
            expect(identity.signedPreKeys).toContain(preKeyPair);
        });

        it('generates extractable pre-keys when specified', async () => {
            const preKeyPair = await didManager.generateNewPreKeyPair(
                identity,
                true,
            );

            expect(preKeyPair.privateKey.extractable).toBe(true);
            expect(preKeyPair.publicKey.key.extractable).toBe(true);
        });

        it('generates non-extractable pre-keys by default', async () => {
            const preKeyPair = await didManager.generateNewPreKeyPair(
                identity,
                false,
            );

            expect(preKeyPair.privateKey.extractable).toBe(false);
            expect(preKeyPair.publicKey.key.extractable).toBe(true);
        });
    });

    describe('resolve', () => {
        it('resolves DID document for generated identity', async () => {
            const identity = await didManager.generate();
            const didDoc = await didManager.resolve(identity.did);

            expect(didDoc).toMatchObject({
                id: identity.did,
                ik: expect.any(String),
                ek: expect.any(String),
                signature: expect.any(String),
                endpoints: expect.any(Array),
            });
        });

        it('throws error for unknown DID', async () => {
            const unknownDid = 'did:doc:unknown';
            await expect(didManager.resolve(unknownDid)).rejects.toThrow();
        });
    });
});
