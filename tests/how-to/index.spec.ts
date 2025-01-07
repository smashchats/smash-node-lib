import { socketServerUrl } from '@tests/jest.global.js';
import { TestMessage, TestUtils } from '@tests/utils/events.utils.js';
import { TEST_CONFIG, aliasWaitFor, delay } from '@tests/utils/time.utils.js';
import { TestPeer, createPeer } from '@tests/utils/user.utils.js';
import {
    EncapsulatedIMProtoMessage,
    IMProfile,
    IMText,
    IM_CHAT_TEXT,
    IM_PROFILE,
    Logger,
    SmashMessaging,
} from 'smash-node-lib';

const ISO8601_TIMESTAMP_REGEX =
    /^(?<year>-?(?:[1-9][0-9]*)?[0-9]{4})-(?<month>1[0-2]|0[1-9])-(?<day>3[01]|0[1-9]|[12][0-9])T(?<hour>2[0-3]|[01][0-9]):(?<minute>[0-5][0-9]):(?<second>[0-5][0-9])(?:\.(?<ms>[0-9]+))?(?<timezone>Z|[+-](?:2[0-3]|[01][0-9]):[0-5][0-9])$/;

// TODO: refactor test suite into How To guides generation material

/**
 * **************************************************************
 *  tests generic to all Smash Peers
 * **************************************************************
 */

// TODO use case with only one peer configured with SME
// describe('Only Bob is registered to an SME.', () => {

describe('[SmashMessaging] Between peers registered to a SME', () => {
    const logger = new Logger('index.spec', 'DEBUG');
    const waitForEventCancelFns: (() => void)[] = [];
    const waitFor = aliasWaitFor(waitForEventCancelFns, logger);

    let RealDate: DateConstructor;
    let mockedNow: Date;
    let dateSpy: jest.SpyInstance;

    let alice: TestPeer;
    let bob: TestPeer;

    let updatedAliceMeta: IMProfile;

    beforeAll(async () => {
        RealDate = Date;
        mockedNow = new RealDate(TEST_CONFIG.INITIAL_DATE);
        global.Date = class extends RealDate {
            constructor() {
                super();
                return mockedNow;
            }
        } as DateConstructor;
        SmashMessaging.setCrypto(crypto);
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    });

    afterAll(async () => {
        global.Date = RealDate;
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    });

    beforeEach(async () => {
        dateSpy = jest
            .spyOn(Date, 'now')
            .mockImplementation(() => mockedNow.getTime());
        [alice, bob] = await Promise.all([
            createPeer('alice', socketServerUrl),
            createPeer('bob', socketServerUrl),
        ]);
        updatedAliceMeta = {
            did: alice.messaging.did,
            title: 'Alice',
            description: 'Alice is a cool person',
            avatar: 'https://alice.com/picture.png',
        };
    }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);

    afterEach(async () => {
        await Promise.all([alice?.messaging.close(), bob?.messaging.close()]);
        waitForEventCancelFns.forEach((cancel) => cancel());
        waitForEventCancelFns.length = 0;
        jest.resetAllMocks();
        dateSpy.mockRestore();
    }, TEST_CONFIG.TEST_TIMEOUT_MS * 3);

    describe('Alice updates their profile metadata BEFORE chatting with Bob', () => {
        it('Bob doesnt receive the update', async () => {
            const waitForBobToReceiveData = waitFor(bob.messaging, 'data', {
                timeout: TEST_CONFIG.MESSAGE_DELIVERY,
            });
            await alice.messaging.updateMeta(updatedAliceMeta);
            await expect(waitForBobToReceiveData).rejects.toThrow();
            expect(bob.onData).not.toHaveBeenCalled();
        });
    });

    describe('Alice sends one message to Bob', () => {
        const TEST_MESSAGE: TestMessage = {
            text: 'hello world 1',
            sha256: '5M5Fsom9c/BefiQKkexx7K+wlMglxoejVcHP6KXKfvI=',
        };

        let aliceSentMessage: EncapsulatedIMProtoMessage;
        let bobReceivedTextMessage: Promise<void>;

        beforeEach(async () => {
            logger.debug('Setting up single message test');

            // Clear existing events
            await TestUtils.getDataEvents(
                bob.did.endpoints[0].preKey,
                'DELETE',
            );

            bobReceivedTextMessage = waitFor(bob.messaging, IM_CHAT_TEXT);

            // Send test message
            aliceSentMessage = await alice.messaging.send(
                bob.did,
                new IMText(TEST_MESSAGE.text),
            );

            await delay(TEST_CONFIG.MESSAGE_DELIVERY);
        });

        it(
            "delivers the initial message to Bob's declared SME",
            async () => {
                const events = await TestUtils.pollForDataEvent(
                    bob.did.endpoints[0].preKey,
                );

                expect(events?.length).toBeGreaterThan(0);
                expect(events[0]).toMatchObject({
                    peerId: bob.did.endpoints[0].preKey,
                    sessionId: expect.any(String),
                    data: expect.anything(),
                });

                await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);

                expect(alice.onStatus).toHaveBeenCalledWith(
                    'delivered',
                    expect.arrayContaining([TEST_MESSAGE.sha256]),
                );
            },
            TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT,
        );

        it('contains a content-addressable ID', async () => {
            expect(aliceSentMessage).toMatchObject({
                sha256: TEST_MESSAGE.sha256,
            } as EncapsulatedIMProtoMessage);
        });

        it('contains a valid timestamp', async () => {
            const TIMESTAMP_PRECISION = 1000; // seconds precision
            const nowTime = mockedNow.getTime() / TIMESTAMP_PRECISION;

            expect(aliceSentMessage).toMatchObject({
                timestamp: expect.stringMatching(ISO8601_TIMESTAMP_REGEX),
            } as EncapsulatedIMProtoMessage);

            const messageTime =
                new Date(aliceSentMessage.timestamp).getTime() /
                TIMESTAMP_PRECISION;
            expect(messageTime).toBeCloseTo(nowTime, 0);
        });

        describe('Alice updates their profile metadata AFTER chatting with Bob', () => {
            it('Bob receives the update', async () => {
                const waitForBobToReceiveProfile = waitFor(
                    bob.messaging,
                    IM_PROFILE,
                );
                await alice.messaging.updateMeta(updatedAliceMeta);
                await waitForBobToReceiveProfile;
                expect(bob.onData).toHaveBeenCalledWith(
                    alice.did.id,
                    expect.objectContaining<
                        Partial<EncapsulatedIMProtoMessage>
                    >({
                        data: expect.objectContaining<IMProfile>({
                            ...updatedAliceMeta,
                        }),
                    }),
                );
            });
        });

        describe('then Bob', () => {
            beforeEach(async () => {
                await bobReceivedTextMessage;
            });

            it('receives the message once', async () => {
                expect(bob.onData.mock.calls.length).toBeGreaterThan(1);
                expect(bob.onData.mock.calls.length).toBeLessThanOrEqual(
                    2 * TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE + 1,
                );
            });

            it('can decrypt the message content', async () => {
                expect(bob.onData).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        data: aliceSentMessage.data,
                    } as EncapsulatedIMProtoMessage),
                );
            });

            it('knows Alice identity (DID)', async () => {
                expect(bob.onData).toHaveBeenCalledWith(
                    alice.did.id,
                    expect.anything(),
                );
            });

            it('successfully replies to Alice', async () => {
                const REPLY_MESSAGE = 'hello back';
                const lastMessage = bob.onData.mock.lastCall[1];
                const receivedAliceDID = bob.onData.mock.lastCall[0];

                expect(receivedAliceDID).toBe(alice.did.id);

                jest.resetAllMocks();

                const aliceReceivedTextMessage = waitFor(
                    alice.messaging,
                    IM_CHAT_TEXT,
                );
                await bob.messaging.send(
                    alice.did,
                    new IMText(REPLY_MESSAGE, lastMessage.sha256),
                );
                await aliceReceivedTextMessage;

                expect(alice.onData).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({ data: REPLY_MESSAGE }),
                );
            });
        });
    });

    describe('Three users registered to the same SME', () => {
        let charlie: TestPeer;

        beforeEach(async () => {
            charlie = await createPeer('charlie', socketServerUrl);
            await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
        });

        afterEach(async () => {
            await charlie?.messaging.close();
        });

        it('Alice and Bob can message each other without errors while Charlie is connected', async () => {
            const TEST_MESSAGES = {
                aliceToBob: 'Hello Bob!',
                bobToAlice: 'Hi Alice!',
            };

            // Message exchange
            const bobReceivedTextMessage = waitFor(bob.messaging, IM_CHAT_TEXT);
            const aliceSentMessage = await alice.messaging.send(
                bob.did,
                new IMText(TEST_MESSAGES.aliceToBob),
            );
            await bobReceivedTextMessage;

            const aliceReceivedTextMessage = waitFor(
                alice.messaging,
                IM_CHAT_TEXT,
            );
            await bob.messaging.send(
                alice.did,
                new IMText(TEST_MESSAGES.bobToAlice, aliceSentMessage.sha256),
            );
            await aliceReceivedTextMessage;

            // Verify message delivery
            expect(bob.onData).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ data: TEST_MESSAGES.aliceToBob }),
            );
            expect(alice.onData).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ data: TEST_MESSAGES.bobToAlice }),
            );
            expect(charlie.onData).not.toHaveBeenCalled();
        });
    });

    // TODO (later) Poste Restante
    // TODO (later) DID refresh + TODO timeout/retries/...
    // TODO P2P2
    // TODO then, Bob and Alice configure P2P (or have Alice do it from start but not Bob?)
    // TODO and Bob's queued messages pass through
    // TODO assert reusing the same encryption session all along
    // TODO assert Alice's signature(?)—(or done at sending message already?)
    // TODO test with SME added later on Alice's side

    describe('Alice sends two messages to Bob', () => {
        it('Bob receives the two messages', async () => {
            const messages = ['0', '1'];
            const messagePromises = [
                alice.messaging.send(bob.did, new IMText(messages[0])),
                alice.messaging.send(bob.did, new IMText(messages[1])),
            ];

            const bobReceivedTwoTextMessages = waitFor(
                bob.messaging,
                IM_CHAT_TEXT,
                { count: 2 },
            );

            const firstMessage = await messagePromises[0];
            await delay(TEST_CONFIG.MESSAGE_DELIVERY);
            const secondMessage = await messagePromises[1];

            await bobReceivedTwoTextMessages;

            const messageHashes = [firstMessage.sha256, secondMessage.sha256];

            const expectedCalls = 2 + TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE;
            // account for possible ACKs
            expect(bob.onData.mock.calls.length).toBeGreaterThanOrEqual(
                expectedCalls,
            );

            messages.forEach((message, index) => {
                expect(bob.onData).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        data: message,
                        sha256: messageHashes[index],
                    } as EncapsulatedIMProtoMessage),
                );
            });
        });
    });
});
