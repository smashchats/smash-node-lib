import { Identity } from '2key-ratchet';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    ProfileListSmashMessage,
    Relationship,
    SMEConfigJSONWithoutDefaults,
    SmashActionJson,
    SmashDID,
    SmashMessaging,
    SmashNAB,
    SmashProfile,
    SmashUser,
} from 'smash-node-lib';
import { Server, Socket } from 'socket.io';

// @ts-ignore
import { aliasWaitFor } from './time.utils';
// @ts-ignore
import { peerArgs } from './user.utils';

// TODO docs library interface (config, events, etc)
// TODO docs neighborhood admin bot API and example
// TODO test suite covering User with multiple Neighborhoods

/** **************************************************************
 *  tests specific to the Smash Neighborhood Admin Bot API and Neighborhood-related actions
 * **************************************************************
 */

describe('SmashMessaging: Neighborhood-related actions', () => {
    // TODO (note) small-hash did when trusting and loop over verifies
    // --> note this adds no security whatsoever; albeit being a useful optimization

    let socketServer: Server;
    let socketServerUrl = '';
    const activeSockets: Socket[] = [];
    const onSMEConnection = jest.fn();

    beforeAll((done) => {
        const httpServer = createServer();
        socketServer = new Server(httpServer);
        socketServer.on('connection', async (client: Socket) => {
            onSMEConnection(client);
            activeSockets.push(client);
            client.on('data', async (peerId, sessionId, data, acknowledge) => {
                activeSockets
                    .filter((socket) => client.id !== socket.id)
                    .forEach((socket) => socket.emit('data', sessionId, data));
                acknowledge();
            });
        });
        httpServer.listen(() => {
            const port = (httpServer.address() as AddressInfo).port;
            socketServerUrl = `http://localhost:${port}`;
            done();
        });
        SmashMessaging.setCrypto(crypto);
    });

    afterAll(() => {
        socketServer.close();
    });

    const waitForEventCancelFns: Function[] = [];
    const waitFor = aliasWaitFor(waitForEventCancelFns);
    let nab: SmashNAB;
    let nabDid: SmashDID;
    const onNabJoin: jest.Mock = jest.fn();
    let nabSMEConfig: SMEConfigJSONWithoutDefaults[];

    beforeEach(async () => {
        const [identity, config] = await peerArgs(socketServerUrl);
        nabSMEConfig = config;
        nab = new SmashNAB(identity);
        await nab.initEndpoints(config);
        await waitFor(socketServer, 'connection');
        nabDid = await nab.getDID();
        nab.on('join', onNabJoin);
    });

    afterEach(async () => {
        await nab.close();
        waitForEventCancelFns.forEach((cancel) => cancel());
        waitForEventCancelFns.length = 0;
        jest.resetAllMocks();
    });

    it('can export their NBH JOIN config', async () => {
        const joinInfo = await nab.getJoinInfo();
        expect(joinInfo).toMatchObject({
            action: 'join',
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
            action: 'join',
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

    describe('when a user', () => {
        let user: SmashUser;
        let userIdentity: Identity;
        let userSMEConfig: SMEConfigJSONWithoutDefaults[];
        const onUserNBHAdded: jest.Mock = jest.fn();
        const onUserDiscover = jest.fn();

        beforeEach(async () => {
            const [identity, config] = await peerArgs(socketServerUrl);
            userIdentity = identity;
            userSMEConfig = config;
            user = new SmashUser(userIdentity);
            user.on('nbh_added', onUserNBHAdded);
            user.on('nbh_profiles', onUserDiscover);
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
            expect(onSMEConnection).toHaveBeenCalledTimes(1);
            await user.join(await nab.getJoinInfo(nabSMEConfig));
            await waitFor(socketServer, 'connection');
            expect(onSMEConnection).toHaveBeenCalledTimes(2);
        });

        const discovered: SmashProfile[] = [
            {
                did: {
                    ik: 'any',
                    ek: 'any',
                    signature: 'any',
                    endpoints: [],
                },
            },
        ];
        const sendDiscoveredProfiles = async () => {
            const userReceivedMessage = waitFor(user, 'message');
            await nab.sendMessage(await user.getDID(), {
                type: 'profiles',
                data: discovered,
            } as ProfileListSmashMessage);
            return userReceivedMessage;
        };

        describe('joining the NBH', () => {
            let nabReceivedJoin: Promise<void>;

            beforeEach(async () => {
                await user.initEndpoints(userSMEConfig);
                nabReceivedJoin = waitFor(nab, 'join');
                await user.join(await nab.getJoinInfo());
            });

            // TODO JOIN with data (eg, social graph ((oneway hash did only)), TOTP, etc)
            it('sends a JOIN message to the NAB', async () => {
                const userDid = await user.getDID();
                await nabReceivedJoin;
                expect(onNabJoin).toHaveBeenCalledWith(
                    expect.objectContaining({
                        ik: userDid.ik,
                        ek: userDid.ek,
                    }),
                    expect.anything(),
                );
            });

            it('triggers a nbh_added user event', async () => {
                // TODO useless if there's no kind of confirmation
                // TODO trigger on NAB profile receive?
                expect(onUserNBHAdded).toHaveBeenCalledTimes(1);
                expect(onUserNBHAdded).toHaveBeenCalledWith(
                    expect.objectContaining({
                        ik: nabDid.ik,
                        ek: nabDid.ek,
                    }),
                );
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
                        expect.anything(),
                        discovered,
                    );
                });
            });

            describe('User Actions', () => {
                let targetUser: SmashUser;
                let onNabAction: jest.Mock;
                let targetDid: SmashDID;
                let counter: number;

                beforeEach(async () => {
                    const [identity] = await peerArgs();
                    targetUser = new SmashUser(identity);
                    onNabAction = jest.fn();
                    nab.on('action', onNabAction);
                    targetDid = await targetUser.getDID();
                    counter = 0;
                });

                afterEach(async () => {
                    await targetUser.close();
                });

                const testAction = async (
                    action: Relationship,
                    inverted: boolean = false,
                ) => {
                    const nabReceivedAction = waitFor(nab, 'action');
                    await user[action as 'smash' | 'pass' | 'clear'](targetDid);
                    await nabReceivedAction;
                    const userDid = await user.getDID();
                    expect(onNabAction).toHaveBeenCalledTimes(
                        inverted ? counter : counter + 1,
                    );
                    if (!inverted) {
                        counter++;
                        expect(onNabAction).toHaveBeenCalledWith(
                            expect.objectContaining({
                                ik: userDid.ik,
                                ek: userDid.ek,
                            }),
                            expect.objectContaining({
                                target: expect.objectContaining({
                                    ik: targetDid.ik,
                                    ek: targetDid.ek,
                                }),
                                action: action,
                            }),
                            expect.anything(),
                        );
                    }
                };

                it('should perform Smash action and notify NAB', async () => {
                    await testAction('smash');
                });

                it('should perform Pass action and notify NAB', async () => {
                    await testAction('pass');
                });

                it('should not perform (already cleared) Clear action', async () => {
                    await testAction('clear', true);
                });

                it('should perform successive actions', async () => {
                    await testAction('pass');
                    await testAction('clear');
                    await testAction('smash');
                    await testAction('pass');
                });

                it('same successive actions shouldnt trigger twice', async () => {
                    await testAction('pass');
                    await testAction('pass', true);
                });
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
