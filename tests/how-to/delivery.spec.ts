import { Crypto } from '@peculiar/webcrypto';
import { TEST_CONFIG, aliasWaitFor, delay } from '@tests/utils/time.utils.js';
import {
    TestPeer,
    createPeer,
    defaultDidManager,
} from '@tests/utils/user.utils.js';
import {
    SME_PUBLIC_KEY,
    emptySocketServerUrl,
    quietSocketServerUrl,
    socketServerUrl,
} from '@tests/vitest.sme-server.js';
import {
    DIDDocument,
    EncapsulatedIMProtoMessage,
    IMText,
    Logger,
    SmashEndpoint,
    SmashMessaging,
} from 'smash-node-lib';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

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
        const crypto = new Crypto();
        SmashMessaging.setCrypto(crypto);
    });

    afterEach(async () => {
        logger.debug('>> canceling all waiters');
        await Promise.all(waitForEventCancelFns.map((cancel) => cancel()));
        waitForEventCancelFns.length = 0;
        logger.debug('>> resetting mocks');
        vi.resetAllMocks();
    });

    afterAll(async () => {
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    });

    describe('Alice', () => {
        let alice: TestPeer;

        const sendMsgTo = async (
            bob: TestPeer,
            message: string = 'test message',
        ) =>
            alice?.messaging.send(
                bob.did,
                new IMText(message),
            ) as Promise<EncapsulatedIMProtoMessage>;

        beforeEach(async () => {
            alice = await createPeer('alice', socketServerUrl);
        }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);

        afterEach(async () => {
            await alice?.messaging.close();
        }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);

        describe('sends a message to Bob on a valid SME', () => {
            let bob: TestPeer;

            beforeEach(async () => {
                bob = await createPeer('bob', socketServerUrl);
            });

            afterEach(async () => {
                await bob?.messaging.close();
            }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);

            it('should receive a DELIVERED ack on SME delivery', async () => {
                const waitForStatus = waitFor(alice?.messaging, 'status');
                const sent = await sendMsgTo(bob);
                await waitForStatus;
                expect(alice?.onStatus).toHaveBeenCalledWith(
                    'delivered',
                    expect.arrayContaining([sent.sha256]),
                );
            });

            describe('then when Bob receives it', () => {
                it('should get a RECEIVED ack from Bob', async () => {
                    const waitForBobToReceive = waitFor(bob.messaging, 'data');
                    const sent = await sendMsgTo(bob);
                    await waitForBobToReceive;
                    await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                    expect(alice?.onStatus).toHaveBeenCalledWith(
                        'received',
                        expect.arrayContaining([sent.sha256]),
                    );
                });
            });

            it('message ACKs should NOT loop', async () => {
                const waitForBobToReceive = waitFor(bob.messaging, 'data');
                await sendMsgTo(bob);
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
            let bob: TestPeer;
            afterEach(async () => {
                await bob?.messaging.close();
            }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);

            it(
                'should NOT receive a DELIVERED ack (no valid SME)',
                async () => {
                    bob = await createPeer('bob');
                    const preKeyPair =
                        await defaultDidManager.generateNewPreKeyPair(
                            bob.identity,
                        );
                    bob.messaging.endpoints.connect(
                        {
                            url: emptySocketServerUrl,
                            smePublicKey: SME_PUBLIC_KEY,
                        },
                        preKeyPair,
                    );
                    bob.did = await bob.messaging.getDIDDocument();
                    await sendMsgTo(bob);
                    await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                    expect(alice?.onStatus).not.toHaveBeenCalled();
                },
                TEST_CONFIG.TEST_TIMEOUT_MS * 2,
            );
        });

        describe('sends a message to Bob on an Endpoint that doesnt send ACKs', () => {
            let bob: TestPeer;
            afterEach(async () => {
                await bob?.messaging.close();
            }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);
            it(
                'should stop trying to send the message upon RECEIVED ack',
                async () => {
                    logger.info('>>>> RECEIVED ACK should clear queue');
                    let sent: EncapsulatedIMProtoMessage | undefined;

                    logger.info('>> Creating Bob with quiet endpoint');
                    bob = await createPeer('bob', quietSocketServerUrl);

                    logger.info('>> Alice sends a message to Bob');
                    alice?.messaging
                        .send(bob.did, new IMText('test message'))
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
                    await delay(TEST_CONFIG.MESSAGE_DELIVERY * 30);

                    logger.info('>> Verify that bob received message');
                    expect(bob?.onData).toHaveBeenCalledWith(
                        alice?.did.id,
                        expect.objectContaining({
                            sha256: sent?.sha256,
                        }),
                    );

                    logger.info(
                        '>> Verify that message was marked as received',
                    );
                    expect(alice?.onStatus).toHaveBeenCalledWith(
                        'received',
                        expect.arrayContaining([sent?.sha256]),
                    );

                    logger.info('>> Verify that message stopped re-sending');
                    expect(bob?.onData.mock.calls.length).toBeLessThanOrEqual(
                        (1 + 2 * TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE) * 2,
                    );
                },
                TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT * 6,
            );
        });

        describe('sends a message to Bob a SME that dont know him', () => {
            let sent: EncapsulatedIMProtoMessage;
            let bob: TestPeer;

            beforeEach(async () => {
                logger.debug('>> Creating Bob with invalid SME');
                bob = await createPeer('bob', emptySocketServerUrl);

                logger.debug('>> Alice sends a message to Bob ');
                const oldBobDid = bob.did;
                const oldBobEndpoint = bob.did.endpoints[0] as SmashEndpoint;
                // mocked to have a valid-looking SME
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
                defaultDidManager.set(bob.did);
                sent = await sendMsgTo(bob);
            }, TEST_CONFIG.TEST_TIMEOUT_MS * 6);

            afterEach(async () => {
                await bob?.messaging.close();
            }, TEST_CONFIG.TEST_TIMEOUT_MS * 4);

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
                        const bobReceivedSomeData = waitFor(
                            bob.messaging,
                            'data',
                            {
                                timeout:
                                    TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT * 2,
                            },
                        );
                        const aliceReceivedStatusUpate = waitFor(
                            alice?.messaging,
                            'status',
                            {
                                timeout: TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT,
                            },
                        );

                        const endpointToReconfig = bob.did.endpoints[0];
                        await bob.messaging.endpoints.reset([
                            {
                                ...endpointToReconfig,
                                url: socketServerUrl,
                                smePublicKey: SME_PUBLIC_KEY,
                            },
                        ]);

                        await bobReceivedSomeData;

                        expect(bob.onData).toHaveBeenCalledWith(
                            alice?.did.id,
                            expect.objectContaining({
                                sha256: sent.sha256,
                            }),
                        );

                        await aliceReceivedStatusUpate;
                        await delay(TEST_CONFIG.MESSAGE_DELIVERY);

                        expect(alice?.onStatus).toHaveBeenCalledWith(
                            'received',
                            expect.arrayContaining([sent.sha256]),
                        );
                    },
                    TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT * 5,
                );
            });
        });
    });
});

// TODO: similar test than below but asserting upon DID reception incl. new endpoints
// TODO: later is this would require a fetch::DID method that isnt yet available
