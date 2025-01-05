import { Crypto } from '@peculiar/webcrypto';
import { SME_PUBLIC_KEY, socketServerUrl } from '@tests/jest.global.js';
import { TEST_CONFIG, aliasWaitFor, delay } from '@tests/utils/time.utils.js';
import { defaultDidManager } from '@tests/utils/user.utils.js';
import {
    DIDDocument,
    DIDString,
    IMPeerIdentity,
    IMProtoMessage,
    Logger,
    NBH_ADDED,
    NBH_PROFILE_LIST,
    Relationship,
    SMASH_NBH_JOIN,
    SMASH_NBH_RELATIONSHIP,
    SMASH_PROFILE_LIST,
    SMEConfigJSONWithoutDefaults,
    SmashActionJson,
    SmashMessaging,
    SmashNAB,
    SmashProfileList,
    SmashUser,
} from 'smash-node-lib';

// TODO docs library interface (config, events, etc)
// TODO docs neighborhood admin bot API and example
// TODO test suite covering User with multiple Neighborhoods

// TODO: refactor test suite into How To guides generation material

/** **************************************************************
 *  tests specific to the Smash Neighborhood Admin Bot API and Neighborhood-related actions
 * **************************************************************
 */

class TestNAB extends SmashNAB {
    public onJoin = jest.fn();
    public onDiscover = jest.fn();
    public onRelationship = jest.fn();
}

describe('SmashMessaging: Neighborhood-related actions', () => {
    // TODO (note) small-hash did when trusting and loop over verifies
    // --> note this adds no security whatsoever; albeit being a useful optimization

    beforeAll(() => {
        const crypto = new Crypto();
        SmashMessaging.setCrypto(crypto);
    });

    const waitForEventCancelFns: (() => void)[] = [];
    const waitFor = aliasWaitFor(waitForEventCancelFns, new Logger('nbh.spec'));
    let nab: SmashNAB;
    let nabDid: DIDDocument;
    let nabSMEConfig: SMEConfigJSONWithoutDefaults[];

    beforeEach(async () => {
        const identity = await defaultDidManager.generate();
        nabSMEConfig = [
            {
                url: socketServerUrl,
                smePublicKey: SME_PUBLIC_KEY,
            },
        ];
        nab = new TestNAB(identity, 'TestNAB', 'DEBUG');
        const preKeyPair =
            await defaultDidManager.generateNewPreKeyPair(identity);
        await nab.endpoints.connect(nabSMEConfig[0], preKeyPair);
        await delay(100);
        nabDid = await nab.getDIDDocument();
    });

    afterEach(async () => {
        await nab.close();
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
        waitForEventCancelFns.forEach((cancel) => cancel());
        waitForEventCancelFns.length = 0;
        jest.resetAllMocks();
    });

    afterAll(async () => {
        await nab?.close();
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    });

    it('can export their NBH JOIN config', async () => {
        const joinInfo = await nab.getJoinInfo();
        expect(joinInfo).toMatchObject({
            action: SMASH_NBH_JOIN,
            did: expect.objectContaining({
                ik: nabDid.ik,
                ek: nabDid.ek,
                endpoints: nabDid.endpoints,
            }),
        } as SmashActionJson);
        expect(joinInfo).not.toHaveProperty('config');
    });

    it('can export their NBH JOIN config including SME', async () => {
        expect(await nab.getJoinInfo(nabSMEConfig)).toMatchObject({
            action: SMASH_NBH_JOIN,
            did: expect.objectContaining({
                ik: nabDid.ik,
                ek: nabDid.ek,
                endpoints: nabDid.endpoints,
            }),
            config: {
                sme: expect.arrayContaining([
                    expect.objectContaining({
                        url: nabSMEConfig[0].url,
                        smePublicKey: nabSMEConfig[0].smePublicKey,
                    }),
                ]),
            },
        });
    });

    it('join config includes non-default SME config values', async () => {
        const customConfig = {
            url: 'http://custom.url',
            smePublicKey: 'customKey==',
            keyAlgorithm: { name: 'ECDH', namedCurve: 'P-384' } as KeyAlgorithm,
            challengeEncoding: 'base64' as const, // Same as default
        };

        const joinInfo = await nab.getJoinInfo([customConfig]);

        expect(joinInfo.config?.sme?.[0]).toMatchObject({
            url: customConfig.url,
            smePublicKey: customConfig.smePublicKey,
            keyAlgorithm: customConfig.keyAlgorithm,
        });
        // Should not include challengeEncoding since it matches default
        expect(joinInfo.config?.sme?.[0]).not.toHaveProperty(
            'challengeEncoding',
        );
    });

    it('handles multiple SME configs with different non-default values', async () => {
        const configs = [
            {
                url: 'http://sme1.url',
                smePublicKey: 'key1==',
                encryptionAlgorithm: { name: 'AES-CBC', length: 128 },
            },
            {
                url: 'http://sme2.url',
                smePublicKey: 'key2==',
                keyAlgorithm: {
                    name: 'ECDH',
                    namedCurve: 'P-384',
                } as KeyAlgorithm,
            },
        ];

        const joinInfo = await nab.getJoinInfo(configs);

        expect(joinInfo.config?.sme).toHaveLength(2);
        expect(joinInfo.config?.sme?.[0]).toMatchObject({
            url: configs[0].url,
            smePublicKey: configs[0].smePublicKey,
            encryptionAlgorithm: configs[0].encryptionAlgorithm,
        });
        expect(joinInfo.config?.sme?.[1]).toMatchObject({
            url: configs[1].url,
            smePublicKey: configs[1].smePublicKey,
            keyAlgorithm: configs[1].keyAlgorithm,
        });
    });

    describe('when a user', () => {
        let user: SmashUser;
        let userIdentity: IMPeerIdentity;
        const onUserNBHAdded: jest.Mock = jest.fn();
        const onUserDiscover = jest.fn();

        beforeEach(async () => {
            const identity = await defaultDidManager.generate();
            userIdentity = identity;
            user = new SmashUser(identity, 'user', 'DEBUG');
            user.on(NBH_ADDED, onUserNBHAdded);
            user.on(NBH_PROFILE_LIST, onUserDiscover);
        });

        afterEach(async () => {
            await user.close();
            await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
        });

        // TODO Poste Restante scenario with NAB (either here or in the Peer tests)
        it('auto-configures an SME with a JOIN action', async () => {
            // TODO request User to confirm action before applying
            // TODO check that updated config is shared with active peers
            // TODO ensure valid SME
            // TODO lib event (updated profile/SME config)
            expect((await user.getDIDDocument()).endpoints.length).toBe(0);
            await user.join(await nab.getJoinInfo(nabSMEConfig));
            await delay(1500);
            expect((await user.getDIDDocument()).endpoints.length).toBe(1);
        });

        const discovered: SmashProfileList = [
            {
                did: {
                    id: 'did:key:any',
                    ik: 'any',
                    ek: 'any',
                    signature: 'any',
                    endpoints: [],
                },
            },
        ];
        const sendDiscoveredProfiles = async () => {
            await nab.send(await user.getDIDDocument(), {
                type: SMASH_PROFILE_LIST,
                data: discovered,
                after: '',
            } as IMProtoMessage);
            return await delay(TEST_CONFIG.MESSAGE_DELIVERY);
        };

        describe('joining the NBH', () => {
            let nabReceivedJoin: Promise<void>;

            beforeEach(async () => {
                const preKeyPair =
                    await defaultDidManager.generateNewPreKeyPair(userIdentity);
                await user.endpoints.connect(
                    {
                        url: socketServerUrl,
                        smePublicKey: SME_PUBLIC_KEY,
                    },
                    preKeyPair,
                );
                nabReceivedJoin = waitFor(nab, SMASH_NBH_JOIN);
                await user.join(await nab.getJoinInfo());
                await delay(TEST_CONFIG.MESSAGE_DELIVERY * 2);
            });

            // TODO JOIN with data (eg, social graph ((oneway hash did only)), TOTP, etc)
            it('sends a JOIN message to the NAB', async () => {
                const userDid = await user.getDIDDocument();
                await nabReceivedJoin;
                expect(nab.onJoin).toHaveBeenCalledWith(
                    expect.objectContaining({
                        id: userDid.id,
                        ik: userDid.ik,
                        ek: userDid.ek,
                    }),
                    expect.anything(),
                    expect.anything(),
                );
            });

            it('triggers a nbh_added user event', async () => {
                // TODO useless if there's no kind of confirmation
                // TODO trigger on NAB profile receive?
                expect(onUserNBHAdded).toHaveBeenCalledTimes(1);
                expect(onUserNBHAdded).toHaveBeenCalledWith(nabDid.id);
            });

            describe('on NABs discover profiles', () => {
                beforeEach(async () => {
                    await nabReceivedJoin;
                    await sendDiscoveredProfiles();
                });

                it('triggers a nbh_profiles event with the discovered profiles', async () => {
                    // TODO duplicate test with 'refresh'
                    // TODO duplicate test with auto refresh
                    expect(onUserDiscover).toHaveBeenCalledTimes(1);
                    expect(onUserDiscover).toHaveBeenCalledWith(
                        nabDid.id,
                        discovered,
                    );
                });
            });

            describe('on User discover profiles', () => {
                beforeEach(async () => {
                    await user.discover();
                    await delay(500);
                });

                it('triggers a discover event on the NAB side', async () => {
                    expect(nab.onDiscover).toHaveBeenCalledTimes(1);
                });
            });

            describe('User Actions', () => {
                let targetUser: SmashUser;
                let targetDid: DIDString;
                let counter: number;

                beforeEach(async () => {
                    const identity = await defaultDidManager.generate();
                    targetUser = new SmashUser(identity, 'targetUser');
                    targetDid = targetUser.did;
                    counter = 0;
                    (nab.onRelationship as jest.Mock).mockClear();
                });

                afterEach(async () => {
                    await targetUser?.close();
                    await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
                });

                const testAction = async (
                    action: Relationship,
                    expectFailure: boolean = false,
                ) => {
                    const nabReceivedAction = waitFor(
                        nab,
                        SMASH_NBH_RELATIONSHIP,
                        {
                            timeout: TEST_CONFIG.TEST_TIMEOUT_MS,
                        },
                    );
                    await user[action as 'smash' | 'pass' | 'clear'](targetDid);
                    if (expectFailure) {
                        await expect(nabReceivedAction).rejects.toThrow();
                    } else {
                        await nabReceivedAction;
                    }
                    const userDid = await user.getDIDDocument();
                    if (!expectFailure) {
                        counter++;
                        expect(nab.onRelationship).toHaveBeenCalledWith(
                            userDid.id,
                            targetDid,
                            action,
                            expect.anything(),
                            expect.anything(),
                        );
                    }
                    expect(nab.onRelationship).toHaveBeenCalledTimes(counter);
                };

                it(
                    'should perform Smash action and notify NAB',
                    async () => {
                        await testAction('smash');
                    },
                    TEST_CONFIG.TEST_TIMEOUT_MS * 2,
                );

                it(
                    'should perform Pass action and notify NAB',
                    async () => {
                        await testAction('pass');
                    },
                    TEST_CONFIG.TEST_TIMEOUT_MS * 2,
                );

                it(
                    'should not perform (already cleared) Clear action',
                    async () => {
                        await testAction('clear', true);
                    },
                    TEST_CONFIG.TEST_TIMEOUT_MS * 2,
                );

                it(
                    'should perform successive actions',
                    async () => {
                        await testAction('pass');
                        await testAction('clear');
                        await testAction('smash');
                        await testAction('pass');
                    },
                    TEST_CONFIG.TEST_TIMEOUT_MS * 5,
                );

                it(
                    'same successive actions shouldnt trigger twice',
                    async () => {
                        await testAction('pass');
                        await delay(100);
                        await testAction('pass', true);
                    },
                    TEST_CONFIG.TEST_TIMEOUT_MS * 3,
                );
            });
        });

        describe('on not-a-NAB discovered profiles', () => {
            it('doesnt trigger a discover event', async () => {
                await sendDiscoveredProfiles();
                expect(onUserDiscover).not.toHaveBeenCalled();
            });
        });
    });
});

// TODO profile propogation tests according to trust levels (ie, on Smash -> fuller profile)
// TODO block user tests (shouldnt even come through)
// TODO send past relationship updates to new NABs

// TODO: ID/PreKey Management
// describe('Pre-Key Management when joining a Neighborhood', () => {
//     it('generates a new Pre-Key when registering a new SME', async () => {
//         const initialPreKeys = [...identity.signedPreKeys];
//         const join: SmashActionJson = {
//             action: 'join',
//             did: 'any',
//             config: {
//                 sme: [
//                     {
//                         url: socketServerUrl,
//                         smePublicKey: 'any',
//                         // preKeyPair: identity.signedPreKeys[0],
//                     },
//                 ],
//             },
//         };
//         await user.join(join);

//         // After joining, a new Pre-Key should be generated
//         const updatedPreKeys = user.identity.signedPreKeys;

//         expect(updatedPreKeys.length).toBeGreaterThan(
//             initialPreKeys.length,
//         );

//         // The new Pre-Key should be used in the SME configuration
//         const lastPreKey = updatedPreKeys[updatedPreKeys.length - 1];
//         const smePreKey =
//             user.endpoints[user.endpoints.length - 1].preKey;

//         const exportedPreKey = await SmashMessaging.exportKey(
//             lastPreKey.publicKey.key,
//         );

//         expect(smePreKey).toEqual(exportedPreKey);
//     });

//     it('does not reuse Pre-Keys across different SMEs', async () => {
//         const joinFirstSME: SmashActionJson = {
//             action: 'join',
//             did: 'any',
//             config: {
//                 sme: `${socketServerUrl}/sme1`,
//             },
//         };
//         await user.join(joinFirstSME);

//         const firstSMEPreKey =
//             user.endpoints[user.endpoints.length - 1].preKey;

//         const joinSecondSME: SmashActionJson = {
//             action: 'join',
//             did: 'any',
//             config: {
//                 sme: `${socketServerUrl}/sme2`,
//             },
//         };
//         await user.join(joinSecondSME);

//         const secondSMEPreKey =
//             user.endpoints[user.endpoints.length - 1].preKey;

//         expect(firstSMEPreKey).not.toEqual(secondSMEPreKey);
//     });

//     it('includes correct Pre-Key information in the DID for each endpoint', async () => {
//         const join: SmashActionJson = {
//             action: 'join',
//             did: 'any',
//             config: {
//                 sme: socketServerUrl,
//             },
//         };
//         await user.join(join);

//         const userDID = await user.getDID();
//         const endpoint =
//             userDID.endpoints[userDID.endpoints.length - 1];

//         // The endpoint's Pre-Key should match the user's last Pre-Key
//         const lastPreKey =
//             user.identity.signedPreKeys[
//                 user.identity.signedPreKeys.length - 1
//             ];
//         const exportedPreKey = await SmashMessaging.exportKey(
//             lastPreKey.publicKey.key,
//         );

//         expect(endpoint.preKey).toEqual(exportedPreKey);
//     });
// });
