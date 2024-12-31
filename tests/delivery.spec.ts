import {
    SME_PUBLIC_KEY,
    emptySocketServerUrl,
    quietSocketServerUrl,
    socketServerUrl,
} from '@tests/jest.global.js';
import { TEST_CONFIG, aliasWaitFor, delay } from '@tests/time.utils.js';
import { TestPeer, createPeer } from '@tests/user.utils.js';
import {
    DIDDocument,
    EncapsulatedIMProtoMessage,
    Logger,
    SMEConfigJSONWithoutDefaults,
    SmashEndpoint,
    SmashMessaging,
} from 'smash-node-lib';

/**
 * **************************************************************
 *  Testing message delivery and acknowledgment
 * **************************************************************
 */
describe('[Message Delivery] Message delivery and acknowledgment', () => {
    const logger = new Logger('delivery.spec', 'DEBUG');
    const waitForEventCancelFns: (() => void)[] = [];
    const waitFor = aliasWaitFor(waitForEventCancelFns, logger);

    beforeAll(async () => {
        SmashMessaging.setCrypto(crypto);
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    });

    afterEach(async () => {
        logger.debug('>> canceling all waiters');
        await Promise.all(waitForEventCancelFns.map((cancel) => cancel()));
        waitForEventCancelFns.length = 0;
        logger.debug('>> resetting mocks');
        jest.resetAllMocks();
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    });

    afterAll(async () => {
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    });

    describe('Alice', () => {
        let alice: TestPeer;
        let bob: TestPeer;

        const sendMsgToBob = async (message: string = 'test message') =>
            alice?.messaging.sendTextMessage(
                bob.did,
                message,
                '',
            ) as Promise<EncapsulatedIMProtoMessage>;

        beforeEach(async () => {
            alice = await createPeer('alice', socketServerUrl);
        });

        afterEach(async () => {
            await alice?.messaging.close();
            await bob?.messaging.close();
            await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
        }, 20000);

        describe('sends a message to Bob on a valid SME', () => {
            beforeEach(async () => {
                // create bob with 2 prekeys for endpoint renewal
                bob = await createPeer('bob', socketServerUrl, undefined, 2);
            });

            it('should receive a DELIVERED ack on SME delivery', async () => {
                const waitForStatus = waitFor(
                    alice?.messaging,
                    'status',
                    1,
                    TEST_CONFIG.TEST_TIMEOUT_MS / 2,
                );
                const sent = await sendMsgToBob();
                await waitForStatus;
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                expect(alice?.onStatus).toHaveBeenCalledWith(
                    'delivered',
                    expect.arrayContaining([sent.sha256]),
                );
            });

            describe('then when Bob receives it', () => {
                it('should get a RECEIVED ack from Bob', async () => {
                    const waitForBobToReceive = waitFor(bob.messaging, 'data');
                    const sent = await sendMsgToBob();
                    await waitForBobToReceive;
                    await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                    expect(alice?.onStatus).toHaveBeenCalledWith(
                        'received',
                        expect.arrayContaining([sent.sha256]),
                    );
                });
            });

            it('message ACKs should not loop', async () => {
                const waitForBobToReceive = waitFor(bob.messaging, 'data');
                await sendMsgToBob();
                await waitForBobToReceive;
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                // statuses can be grouped, so at most called number of times is the
                // number of messages (+ include protocol overhead)
                expect(alice?.onStatus.mock.calls.length).toBeLessThanOrEqual(
                    2 * (1 + TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE),
                );
            });
        });

        describe('sends a message to Bob on a not valid SME', () => {
            beforeEach(async () => {
                bob = await createPeer('bob');
                bob.messaging.setEndpoints([
                    {
                        url: emptySocketServerUrl,
                        smePublicKey: SME_PUBLIC_KEY,
                    },
                ]);
                bob.did = await bob.messaging.getDIDDocument();
                await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
            });

            it('should NOT receive a DELIVERED ack (no valid SME)', async () => {
                await sendMsgToBob();
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                expect(alice?.onStatus).not.toHaveBeenCalled();
            });
        });

        describe('sends a message to Bob on an Endpoint that doesnt send ACKs', () => {
            it(
                'should stop trying to send the message upon RECEIVED ack',
                async () => {
                    logger.info('>>>> RECEIVED ACK should clear queue');
                    let sent: EncapsulatedIMProtoMessage | undefined;

                    logger.info('>> Creating Bob with quiet endpoint');
                    bob = await createPeer('bob', quietSocketServerUrl);
                    await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);

                    logger.info('>> Alice sends a message to Bob');
                    alice?.messaging
                        .sendTextMessage(bob.did, 'test message', '')
                        .then(
                            (sentMessage: EncapsulatedIMProtoMessage) =>
                                (sent = sentMessage),
                        )
                        .catch((error: Error) => {
                            console.error(
                                'Error sending message:',
                                error.message,
                            );
                        });
                    await delay(TEST_CONFIG.MESSAGE_DELIVERY * 3);

                    logger.info(
                        '>> Verify that message wasnt marked as delivered',
                    );
                    expect(alice?.onStatus).not.toHaveBeenCalledWith(
                        'delivered',
                        expect.arrayContaining([sent?.sha256]),
                    );

                    logger.info('>> Waiting for potential retries to complete');
                    // we need to let long enough for exponential retries to be obviously never ending
                    await delay(TEST_CONFIG.MESSAGE_DELIVERY * 40);

                    logger.info(
                        '>> Verify that message was marked as received',
                    );
                    expect(alice?.onStatus).toHaveBeenCalledWith(
                        'received',
                        expect.arrayContaining([sent?.sha256]),
                    );

                    logger.info('>> Verify that message stopped re-sending');
                    expect(bob?.onData.mock.calls.length).toBeLessThanOrEqual(
                        // *2 to let some delay for the message to be ACKed and cleared
                        (1 + 2 * TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE) * 2,
                    );

                    logger.info('>> Cleanup');
                    await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
                },
                3 * TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT,
            );
        });

        describe('sends a message to Bob a SME that dont know him', () => {
            let sent: EncapsulatedIMProtoMessage;

            beforeEach(async () => {
                logger.debug('>> Creating Bob with invalid SME');
                bob = await createPeer('bob', emptySocketServerUrl);
                await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
                logger.debug(
                    '>> Alice sends a message to Bob (with SME url mocked)',
                );
                const oldBobDid = bob.did;
                const oldBobEndpoint = bob.did.endpoints[0] as SmashEndpoint;
                bob.did = {
                    ...oldBobDid,
                    endpoints: [
                        {
                            url: socketServerUrl,
                            preKey: oldBobEndpoint.preKey,
                            signature: oldBobEndpoint.signature,
                        } as SmashEndpoint,
                    ],
                } as DIDDocument;
                sent = await sendMsgToBob();
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
            });

            it('should NOT receive a DELIVERED ack (no SME mailbox)', async () => {
                logger.debug('>> Verify that message wasnt delivered');
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                expect(alice?.onStatus).not.toHaveBeenCalled();
            });

            describe('then Bob registers with this SME', () => {
                it(
                    'should eventually receive the message without user action',
                    async () => {
                        logger.debug('>> Reconnecting Bob to the default SME');
                        bob.messaging.setEndpoints([
                            {
                                url: socketServerUrl,
                                smePublicKey: SME_PUBLIC_KEY,
                            } as SMEConfigJSONWithoutDefaults,
                        ]);
                        bob.did = await bob.messaging.getDIDDocument();
                        await delay(2 * TEST_CONFIG.TEST_TIMEOUT_MS);
                        expect(bob.onData).toHaveBeenCalledWith(
                            alice?.did.id,
                            expect.objectContaining({
                                sha256: sent.sha256,
                            }),
                        );
                        expect(alice?.onStatus).toHaveBeenCalledWith(
                            'received',
                            expect.arrayContaining([sent.sha256]),
                        );
                    },
                    3 * TEST_CONFIG.TEST_TIMEOUT_MS,
                );
            });
        });
    });
});

// TODO: similar test than below but asserting upon DID reception incl. new endpoints
// TODO: later is this would require a fetch::DID method that isnt yet available
// describe('Bob comes back online with different endpoints', () => {
//     fit('should retry the message after some time', async () => {
//         const baseUrl = socketServerUrl.endsWith('/')
//             ? socketServerUrl
//             : socketServerUrl + '/';
//         const uniqueModifier = Math.random()
//             .toString(36)
//             .substring(2, 15);
//         const uniqueUrl = `${baseUrl}?unique=${uniqueModifier}`;
//         logger.debug(
//             '>> Reconnecting Bob with a different, unique endpoint URL',
//         );
//         bob.messaging.setEndpoints([
//             {
//                 url: uniqueUrl,
//                 smePublicKey: 'smePublicKey==',
//             } as SMEConfigJSONWithoutDefaults,
//         ]);
//         bob.did = await bob.messaging.getDID();
//         await delay(5000);
//         expect(bob.onData).toHaveBeenCalledWith(
//             alice?.did.id,
//             expect.objectContaining({
//                 data: uniqueMessage,
//             }),
//         );
//         expect(alice?.onStatus).toHaveBeenCalledWith(
//             'received',
//             expect.arrayContaining([sent.sha256]),
//         );
//     }, 10000);
// });
