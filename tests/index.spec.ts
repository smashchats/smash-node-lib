import {
    DIDDocument,
    EncapsulatedIMProtoMessage,
    IMProfile,
    Logger,
    SmashMessaging,
} from 'smash-node-lib';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { socketServerUrl } from './jest.global.cjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { aliasWaitFor, delay } from './time.utils';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { peerArgs } from './user.utils';

// Extract constants
const TEST_CONFIG = {
    INITIAL_DATE: '2024-01-01T00:00:00.000Z',
    PROTOCOL_OVERHEAD_SIZE: 1,
    DEFAULT_POLL_ATTEMPTS: 20,
    DEFAULT_POLL_INTERVAL: 500,
    DEFAULT_SETUP_DELAY: 1000,
    MESSAGE_DELIVERY_TIMEOUT: 12000,
} as const;

const ISO8601_TIMESTAMP_REGEX =
    /^(?<year>-?(?:[1-9][0-9]*)?[0-9]{4})-(?<month>1[0-2]|0[1-9])-(?<day>3[01]|0[1-9]|[12][0-9])T(?<hour>2[0-3]|[01][0-9]):(?<minute>[0-5][0-9]):(?<second>[0-5][0-9])(?:\.(?<ms>[0-9]+))?(?<timezone>Z|[+-](?:2[0-3]|[01][0-9]):[0-5][0-9])$/;

// Extract test types
interface TestMessage {
    text: string;
    sha256?: string;
}

interface TestPeer {
    messaging: SmashMessaging;
    did: DIDDocument;
    onMessage: jest.Mock;
    onStatus: jest.Mock;
}

// Extract test utilities
class TestUtils {
    private static logger = new Logger('TestUtils');

    static async createPeer(
        name: string,
        serverUrl?: string,
    ): Promise<TestPeer> {
        const [identity, config] = await peerArgs(serverUrl);
        const messaging = new SmashMessaging(
            identity,
            undefined,
            'DEBUG',
            name,
        );
        await messaging.initEndpoints(config);

        const did = await messaging.getDID();
        const onMessage = jest.fn();
        const onStatus = jest.fn();

        messaging.on('data', onMessage);
        messaging.on('status', onStatus);

        return { messaging, did, onMessage, onStatus };
    }

    static async getDataEvents(
        serverUrl: string,
        peerId: string,
        method: string = 'GET',
    ): Promise<unknown[]> {
        const url = `${serverUrl}/data-events?peerId=${encodeURIComponent(peerId)}`;
        try {
            const response = await fetch(url, { method });
            if (!response.ok) {
                this.logger.error(`Error response: ${await response.text()}`);
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            this.logger.error('Fetch error:', error);
            throw error;
        }
    }

    static async pollForDataEvent(
        serverUrl: string,
        peerId: string,
        maxAttempts = TEST_CONFIG.DEFAULT_POLL_ATTEMPTS,
        interval = TEST_CONFIG.DEFAULT_POLL_INTERVAL,
    ): Promise<unknown[]> {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            this.logger.debug(`Polling attempt ${attempt + 1}/${maxAttempts}`);
            const events = await this.getDataEvents(serverUrl, peerId);
            if (events.length > 0) {
                this.logger.debug(`Found ${events.length} events`);
                return events;
            }
            await delay(interval);
        }
        throw new Error('Timeout waiting for SME data event');
    }
}

/**
 * **************************************************************
 *  tests generic to all Smash Peers
 * **************************************************************
 */

// TODO use case with only one peer configured with SME
// describe('Only Bob is registered to an SME.', () => {

describe('[SmashMessaging] Between peers registered to a SME', () => {
    const logger = new Logger('SmashMessaging');
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

    beforeEach(async () => {
        dateSpy = jest
            .spyOn(Date, 'now')
            .mockImplementation(() => mockedNow.getTime());

        // Create test peers
        alice = await TestUtils.createPeer('alice', socketServerUrl);
        updatedAliceMeta = {
            did: alice.did.id,
            title: 'Alice',
            description: 'Alice is a cool person',
            avatar: 'https://alice.com/picture.png',
        };
        bob = await TestUtils.createPeer('bob', socketServerUrl);
    });

    afterEach(async () => {
        // Cleanup peers
        alice?.messaging.removeAllListeners();
        bob?.messaging.removeAllListeners();
        await alice?.messaging.close();
        await bob?.messaging.close();
        // Reset test state
        waitForEventCancelFns.forEach((cancel) => cancel());
        waitForEventCancelFns.length = 0;
        jest.resetAllMocks();
        dateSpy.mockRestore();
    });

    describe('Alice updates their profile metadata BEFORE chatting with Bob', () => {
        it('Bob doesnt receive the update', async () => {
            await alice.messaging.updateMeta(updatedAliceMeta);
            await delay(TEST_CONFIG.DEFAULT_POLL_INTERVAL);
            expect(bob.onMessage).not.toHaveBeenCalled();
        });
    });

    describe('Alice sends one message to Bob', () => {
        const TEST_MESSAGE: TestMessage = {
            text: 'hello world 1',
            sha256: 'kPay1AyS9MkvDMfXSKhaSeNev02sUpA7k4oauLahq8w=',
        };

        let aliceSentMessage: EncapsulatedIMProtoMessage;
        let bobReceivedMessage: Promise<void>;

        beforeEach(async () => {
            logger.debug('Setting up single message test');

            // Clear existing events
            await TestUtils.getDataEvents(
                socketServerUrl,
                bob.did.endpoints[0].preKey,
                'DELETE',
            );
            await delay(TEST_CONFIG.DEFAULT_POLL_INTERVAL);

            // Setup message receipt expectation
            bobReceivedMessage = waitFor(
                bob.messaging,
                'data',
                1 + TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE,
            );

            // Send test message
            aliceSentMessage = await alice.messaging.sendTextMessage(
                bob.did,
                TEST_MESSAGE.text,
                '0',
            );
        });

        it(
            "delivers the initial message to Bob's declared SME",
            async () => {
                const events = await TestUtils.pollForDataEvent(
                    socketServerUrl,
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
                    TEST_MESSAGE.sha256,
                    'delivered',
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
                await alice.messaging.updateMeta(updatedAliceMeta);
                await delay(TEST_CONFIG.DEFAULT_POLL_INTERVAL);

                expect(bob.onMessage).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        data: expect.objectContaining({
                            ...updatedAliceMeta,
                            did: expect.objectContaining({
                                id: alice.did.id,
                            }),
                        }),
                    }),
                );
            });
        });

        describe('then Bob', () => {
            beforeEach(async () => {
                await bobReceivedMessage;
            });

            it('receives the message once', async () => {
                expect(bob.onMessage).toHaveBeenCalledTimes(
                    1 + TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE,
                );
            });

            it('can decrypt the message content', async () => {
                expect(bob.onMessage).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        data: aliceSentMessage.data,
                    } as EncapsulatedIMProtoMessage),
                );
            });

            it('knows Alice identity (DID)', async () => {
                expect(bob.onMessage).toHaveBeenCalledWith(
                    expect.stringMatching(alice.did.id),
                    expect.anything(),
                );
            });

            it('successfully replies to Alice', async () => {
                const REPLY_MESSAGE = 'hello back';
                const lastMessage = bob.onMessage.mock.lastCall[1];
                const receivedAliceDID = bob.onMessage.mock.lastCall[0];

                expect(receivedAliceDID).toBe(alice.did.id);

                jest.resetAllMocks();
                const aliceReceivedReply = waitFor(alice.messaging, 'data');

                await bob.messaging.sendTextMessage(
                    alice.did,
                    REPLY_MESSAGE,
                    lastMessage.sha256,
                );
                await aliceReceivedReply;

                expect(alice.onMessage).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({ data: REPLY_MESSAGE }),
                );
            });
        });
    });

    describe('Three users registered to the same SME', () => {
        let charlie: TestPeer;

        beforeEach(async () => {
            charlie = await TestUtils.createPeer('charlie', socketServerUrl);
            await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
        });

        afterEach(async () => {
            await charlie.messaging.close();
        });

        it('Alice and Bob can message each other without errors while Charlie is connected', async () => {
            const TEST_MESSAGES = {
                aliceToBob: 'Hello Bob!',
                bobToAlice: 'Hi Alice!',
            };

            const messagePromises = {
                bob: waitFor(
                    bob.messaging,
                    'data',
                    1 + TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE,
                ),
                alice: waitFor(
                    alice.messaging,
                    'data',
                    1 + TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE,
                ),
            };

            // Message exchange
            const aliceSentMessage = await alice.messaging.sendTextMessage(
                bob.did,
                TEST_MESSAGES.aliceToBob,
                '0',
            );
            await messagePromises.bob;

            await bob.messaging.sendTextMessage(
                alice.did,
                TEST_MESSAGES.bobToAlice,
                aliceSentMessage.sha256,
            );
            await messagePromises.alice;

            // Verify message delivery
            expect(bob.onMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ data: TEST_MESSAGES.aliceToBob }),
            );
            expect(alice.onMessage).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ data: TEST_MESSAGES.bobToAlice }),
            );
            expect(charlie.onMessage).not.toHaveBeenCalled();
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
            const messagePromises = {
                all: waitFor(
                    bob.messaging,
                    'data',
                    2 + TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE,
                ),
                first: waitFor(bob.messaging, 'data', 1),
            };

            const firstMessage = await alice.messaging.sendTextMessage(
                bob.did,
                '0',
                '0',
            );
            await messagePromises.first;
            await delay(50);
            await alice.messaging.sendTextMessage(
                bob.did,
                '1',
                firstMessage.sha256,
            );
            await messagePromises.all;

            expect(bob.onMessage).toHaveBeenCalledTimes(
                2 + TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE,
            );

            [0, 1].forEach((index) => {
                expect(bob.onMessage).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        data: `${index}`,
                    } as EncapsulatedIMProtoMessage),
                );
            });
        });
    });
});
