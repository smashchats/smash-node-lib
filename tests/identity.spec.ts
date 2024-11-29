import { IJsonIdentity, Identity } from '2key-ratchet';
import { SmashMessaging } from 'smash-node-lib';

describe('SmashMessaging: Identity utilities', () => {
    beforeAll(() => {
        SmashMessaging.setCrypto(crypto);
    });

    describe('generateIdentity', () => {
        it('generates an identity with default parameters', async () => {
            const identity = await SmashMessaging.generateIdentity();

            expect(identity).toBeInstanceOf(Identity);
            expect(identity.signedPreKeys.length).toBe(1);
            expect(identity.preKeys.length).toBe(0);
        });

        it('generates an identity with custom number of keys', async () => {
            const nbPreKeys = 3;
            const nbOnetimeKeys = 2;

            const identity = await SmashMessaging.generateIdentity(
                nbPreKeys,
                nbOnetimeKeys,
            );

            expect(identity.signedPreKeys.length).toBe(nbPreKeys);
            expect(identity.preKeys.length).toBe(nbOnetimeKeys);
        });

        it('generates extractable keys when specified', async () => {
            const identity = await SmashMessaging.generateIdentity(1, 0, true);

            expect(identity.signingKey.privateKey.extractable).toBe(true);
            expect(identity.signingKey.publicKey.key.extractable).toBe(true);
            expect(identity.exchangeKey.privateKey.extractable).toBe(true);
            expect(identity.exchangeKey.publicKey.key.extractable).toBe(true);
        });

        it('generates non-extractable keys by default', async () => {
            const identity = await SmashMessaging.generateIdentity();

            expect(identity.signingKey.privateKey.extractable).toBe(false);
            expect(identity.signingKey.publicKey.key.extractable).toBe(true);
            expect(identity.exchangeKey.privateKey.extractable).toBe(false);
            expect(identity.exchangeKey.publicKey.key.extractable).toBe(true);
        });
    });

    describe('identity export and parse', () => {
        let identity: Identity;
        let exportedIdentity: IJsonIdentity;

        beforeEach(async () => {
            identity = await SmashMessaging.generateIdentity(1, 0, true);
            const messaging = new SmashMessaging(identity);
            exportedIdentity = await messaging.exportIdentityToJSON();
        });

        describe('exportIdentityToJSON', () => {
            it('exports identity with all required fields', async () => {
                expect(exportedIdentity).toMatchObject({
                    id: expect.any(Number),
                    signingKey: expect.objectContaining({
                        privateKey: expect.any(Object),
                        publicKey: expect.any(Object),
                    }),
                    exchangeKey: expect.objectContaining({
                        privateKey: expect.any(Object),
                        publicKey: expect.any(Object),
                    }),
                    preKeys: expect.any(Array),
                    signedPreKeys: expect.any(Array),
                    createdAt: expect.any(String),
                });
            });

            it('can be re-imported', async () => {
                const parsedIdentity =
                    await SmashMessaging.deserializeIdentity(exportedIdentity);
                expect(parsedIdentity).toBeInstanceOf(Identity);
                expect(parsedIdentity.id).toBe(identity.id);
                expect(parsedIdentity.signedPreKeys.length).toBe(
                    identity.signedPreKeys.length,
                );
                expect(parsedIdentity.preKeys.length).toBe(
                    identity.preKeys.length,
                );
                expect(
                    await parsedIdentity.signingKey.publicKey.thumbprint(),
                ).toBe(await identity.signingKey.publicKey.thumbprint());
                expect(
                    await parsedIdentity.exchangeKey.publicKey.thumbprint(),
                ).toBe(await identity.exchangeKey.publicKey.thumbprint());
            });
        });

        describe('parseIdentityJson', () => {
            it('successfully parses exported identity', async () => {
                const parsedIdentity =
                    await SmashMessaging.deserializeIdentity(exportedIdentity);

                expect(parsedIdentity).toBeInstanceOf(Identity);
                expect(parsedIdentity.id).toBe(identity.id);
                expect(parsedIdentity.signedPreKeys.length).toBe(
                    identity.signedPreKeys.length,
                );
                expect(parsedIdentity.preKeys.length).toBe(
                    identity.preKeys.length,
                );
            });

            it('throws error on invalid identity JSON', async () => {
                const invalidIdentity = {
                    ...exportedIdentity,
                    signingKey: undefined,
                };

                await expect(
                    SmashMessaging.deserializeIdentity(
                        // @ts-expect-error
                        invalidIdentity as IJsonIdentity,
                    ),
                ).rejects.toThrow();
            });

            it('accepts custom key pair parser', async () => {
                const customParser = jest
                    .fn()
                    .mockImplementation(async (keys) => ({
                        privateKey: await SmashMessaging[
                            'reconstituteCryptoKey'
                        ](keys.privateKey),
                        publicKey: await SmashMessaging[
                            'reconstituteCryptoKey'
                        ](keys.publicKey),
                    }));

                await SmashMessaging.deserializeIdentity(
                    exportedIdentity,
                    customParser,
                );

                expect(customParser).toHaveBeenCalled();
            });
        });
    });
});
