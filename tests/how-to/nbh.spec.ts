import { Crypto } from '@peculiar/webcrypto';
import { TEST_CONFIG, aliasWaitFor, delay } from '@tests/utils/time.utils.js';
import { defaultDidManager } from '@tests/utils/user.utils.js';
import { SME_PUBLIC_KEY, socketServerUrl } from '@tests/vitest.sme-server.js';
import {
    DIDDocument,
    DIDString,
    IMPeerIdentity,
    IMProtoMessage,
    Logger,
    NBH_ADDED,
    NBH_PROFILE_LIST,
    Relationship,
    SMASH_NBH_DISCOVER,
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
import {
    Mock,
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

// TODO docs library interface (config, events, etc)
// TODO docs neighborhood admin bot API and example
// TODO test suite covering User with multiple Neighborhoods

// TODO: refactor test suite into How To guides generation material

/** **************************************************************
 *  tests specific to the Smash Neighborhood Admin Bot API and Neighborhood-related actions
 * **************************************************************
 */

class TestNAB extends SmashNAB {
    public onJoin = vi.fn();
    public onDiscover = vi.fn();
    public onRelationship = vi.fn();
}

describe('SmashMessaging: Neighborhood-related actions', () => {
    // TODO (note) small-hash did when trusting and loop over verifies
    // --> note this adds no security whatsoever; albeit being a useful optimization

    beforeAll(() => {
        const crypto = new Crypto();
        SmashMessaging.setCrypto(crypto);
    });

    const logger = new Logger('nbh.spec');
    const waitForEventCancelFns: (() => void)[] = [];
    const waitFor = aliasWaitFor(waitForEventCancelFns, logger);

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
        nabDid = await nab.getDIDDocument();
    });

    afterEach(async () => {
        await nab.close();
        waitForEventCancelFns.forEach((cancel) => cancel());
        waitForEventCancelFns.length = 0;
        vi.resetAllMocks();
    }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);

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
            keyAlgorithm: {
                name: 'ECDH' as const,
                namedCurve: 'P-256' as const,
            },
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
                encryptionAlgorithm: {
                    name: 'AES-GCM' as const,
                    length: 256 as const,
                },
            },
            {
                url: 'http://sme2.url',
                smePublicKey: 'key2==',
                keyAlgorithm: {
                    name: 'ECDH' as const,
                    namedCurve: 'P-256' as const,
                },
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
        const onUserNBHAdded: ReturnType<typeof vi.fn> = vi.fn();
        const onUserDiscover = vi.fn();

        beforeEach(async () => {
            const identity = await defaultDidManager.generate();
            userIdentity = identity;
            user = new SmashUser(identity, 'user', 'DEBUG');
            user.on(NBH_ADDED, onUserNBHAdded);
            user.on(NBH_PROFILE_LIST, onUserDiscover);
        });

        afterEach(async () => {
            await user.close();
        });

        // TODO Poste Restante scenario with NAB (either here or in the Peer tests)
        it('auto-configures an SME with a JOIN action', async () => {
            // TODO request User to confirm action before applying
            // TODO check that updated config is shared with active peers
            // TODO ensure valid SME
            // TODO lib event (updated profile/SME config)
            expect((await user.getDIDDocument()).endpoints.length).toBe(0);
            await user.join(await nab.getJoinInfo(nabSMEConfig));
            await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
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
            const userReceivedDisoveredProfiles = waitFor(
                user,
                SMASH_PROFILE_LIST,
            );
            await nab.send(await user.getDIDDocument(), {
                type: SMASH_PROFILE_LIST,
                data: discovered,
                after: '',
            } as IMProtoMessage);

            return userReceivedDisoveredProfiles;
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
                defaultDidManager.set(await user.getDIDDocument());
                nabReceivedJoin = waitFor(nab, SMASH_NBH_JOIN, {
                    timeout: TEST_CONFIG.TEST_TIMEOUT_MS * 2,
                });
                await user.join(await nab.getJoinInfo());
            }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);

            // TODO JOIN with data (eg, social graph ((oneway hash did only)), TOTP, etc)
            it(
                'sends a JOIN message to the NAB',
                async () => {
                    await nabReceivedJoin;
                    const userDid = await user.getDIDDocument();
                    expect(nab.onJoin).toHaveBeenCalledWith(
                        expect.objectContaining({
                            id: userDid.id,
                            ik: userDid.ik,
                            ek: userDid.ek,
                        }),
                        expect.anything(),
                        expect.anything(),
                    );
                },
                TEST_CONFIG.TEST_TIMEOUT_MS * 3,
            );

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
                }, TEST_CONFIG.TEST_TIMEOUT_MS * 3);

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
                it(
                    'triggers a discover event on the NAB side',
                    async () => {
                        await nabReceivedJoin;
                        const nabReceivedDiscoverRequest = waitFor(
                            nab,
                            SMASH_NBH_DISCOVER,
                        );
                        await user.discover();
                        await nabReceivedDiscoverRequest;
                        expect(nab.onDiscover).toHaveBeenCalledTimes(1);
                    },
                    TEST_CONFIG.TEST_TIMEOUT_MS * 4,
                );
            });

            describe('User Actions', () => {
                let targetUser: SmashUser;
                let targetDid: DIDString;
                let counter: number;

                beforeEach(async () => {
                    await nabReceivedJoin;
                    const identity = await defaultDidManager.generate();
                    targetUser = new SmashUser(identity, 'targetUser');
                    targetDid = targetUser.did;
                    counter = 0;
                    (nab.onRelationship as Mock).mockClear();
                }, TEST_CONFIG.TEST_TIMEOUT_MS * 3);

                afterEach(async () => {
                    await targetUser?.close();
                });

                const testAction = async (
                    action: Relationship,
                    expectFailure: boolean = false,
                ) => {
                    logger.info(
                        `>>> performing ${action} action (expectFailure: ${expectFailure})`,
                    );
                    const nabReceivedAction = waitFor(
                        nab,
                        SMASH_NBH_RELATIONSHIP,
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
                        await delay(50);
                        await testAction('clear');
                        await delay(50);
                        await testAction('smash');
                        await delay(50);
                        await testAction('pass');
                    },
                    TEST_CONFIG.TEST_TIMEOUT_MS * 6,
                );

                it(
                    'same successive actions shouldnt trigger twice',
                    async () => {
                        await testAction('pass');
                        await delay(50);
                        await testAction('pass', true);
                    },
                    TEST_CONFIG.TEST_TIMEOUT_MS * 3,
                );
            });
        });

        describe('on not-a-NAB discovered profiles', () => {
            it('doesnt trigger a discover event', async () => {
                const preKeyPair =
                    await defaultDidManager.generateNewPreKeyPair(userIdentity);
                await user.endpoints.connect(
                    {
                        url: socketServerUrl,
                        smePublicKey: SME_PUBLIC_KEY,
                    },
                    preKeyPair,
                );
                defaultDidManager.set(await user.getDIDDocument());
                const userReceivedNBHEvent = waitFor(user, NBH_PROFILE_LIST);
                await sendDiscoveredProfiles();
                await expect(userReceivedNBHEvent).rejects.toThrow();
                expect(onUserDiscover).not.toHaveBeenCalled();
            });
        });
    });
});

// TODO profile propogation tests according to trust levels (ie, on Smash -> fuller profile)
// TODO block user tests (shouldnt even come through)
// TODO send past relationship updates to new NABs
// TODO: ID/PreKey Management
