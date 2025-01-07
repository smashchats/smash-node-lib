import { Crypto } from '@peculiar/webcrypto';
import {
    SME_PUBLIC_KEY,
    secondarySocketServerUrl,
    socketServerUrl,
} from '@tests/jest.global.js';
import { TestUtils } from '@tests/utils/events.utils.js';
import { TEST_CONFIG, aliasWaitFor, delay } from '@tests/utils/time.utils.js';
import {
    TestPeer,
    createPeer,
    defaultDidManager,
} from '@tests/utils/user.utils.js';
import { IMText, IM_CHAT_TEXT, Logger, SmashMessaging } from 'smash-node-lib';

// TODO: refactor test suite into How To guides generation material

describe('[Sessions] Session Management', () => {
    const logger = new Logger('sessions.spec', 'DEBUG');

    const waitForEventCancelFns: (() => void)[] = [];
    const waitFor = aliasWaitFor(waitForEventCancelFns, logger);

    let alice: TestPeer;
    let bob: TestPeer;

    beforeAll(async () => {
        logger.info('Setting up crypto for tests');
        const crypto = new Crypto();
        SmashMessaging.setCrypto(crypto);
    });

    beforeEach(async () => {
        logger.debug('Creating test peers Alice and Bob');
        [alice, bob] = await Promise.all([
            createPeer('alice', socketServerUrl),
            createPeer('bob', socketServerUrl),
        ]);
    }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);

    afterEach(async () => {
        logger.debug('Cleaning up test peers');
        await Promise.all([alice?.messaging.close(), bob?.messaging.close()]);
        waitForEventCancelFns.forEach((cancel) => cancel());
        waitForEventCancelFns.length = 0;
        jest.resetAllMocks();
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);

    describe('Session Reuse', () => {
        it(
            'should reuse the same session for subsequent messages',
            async () => {
                logger.info('Testing session reuse for subsequent messages');

                // Clear existing events
                logger.debug('Clearing existing events');
                await TestUtils.getDataEvents(
                    bob.did.endpoints[0].preKey,
                    'DELETE',
                );
                await TestUtils.getDataEvents(
                    alice.did.endpoints[0].preKey,
                    'DELETE',
                );

                // Send first message to establish session
                logger.debug('Sending Alice->Bob message to establish session');
                const bobReceivedTextMessage = waitFor(
                    bob.messaging,
                    IM_CHAT_TEXT,
                );
                const msg1 = await alice.messaging.send(
                    bob.did,
                    new IMText('msg1'),
                );
                await bobReceivedTextMessage;

                // Get initial session ID from SME events
                logger.debug('Getting initial session ID');
                const events1 = await TestUtils.pollForDataEvent(
                    bob.did.endpoints[0].preKey,
                );
                const initialSessionId = (events1[0] as { sessionId: string })
                    .sessionId;
                expect(initialSessionId).toBeDefined();
                logger.debug(`Initial session ID: ${initialSessionId}`);

                // Clear events again
                logger.debug('Clearing events before second message');
                await TestUtils.getDataEvents(
                    bob.did.endpoints[0].preKey,
                    'DELETE',
                );
                await TestUtils.getDataEvents(
                    alice.did.endpoints[0].preKey,
                    'DELETE',
                );

                // Send second message
                logger.debug('Sending Bob->Alice message');
                const aliceReceivedTextMessage = waitFor(
                    alice.messaging,
                    IM_CHAT_TEXT,
                );
                await bob.messaging.send(
                    alice.did,
                    new IMText('msg2', msg1.sha256),
                );
                await aliceReceivedTextMessage;

                // Get events for second message
                logger.debug('Getting events for second message');
                const events2 = await TestUtils.pollForDataEvent(
                    alice.did.endpoints[0].preKey,
                );

                // Should use same session ID
                const secondSessionId = (events2[0] as { sessionId: string })
                    .sessionId;
                logger.debug(`Second message session ID: ${secondSessionId}`);
                expect(secondSessionId).toBe(initialSessionId);
            },
            TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT,
        );
    });

    describe('Preferred Endpoint Management', () => {
        beforeEach(async () => {
            logger.debug('Configuring second endpoint for Alice');
            const preKeyPair = await defaultDidManager.generateNewPreKeyPair(
                alice.identity,
            );
            await alice.messaging.endpoints.connect(
                { url: secondarySocketServerUrl, smePublicKey: SME_PUBLIC_KEY },
                preKeyPair,
            );
            alice.did = await alice.messaging.getDIDDocument();
        });

        it(
            'should establish and use preferred endpoints',
            async () => {
                logger.info(
                    'Testing preferred endpoint establishment and usage',
                );

                // Clear existing events for both endpoints
                logger.debug('Clearing existing events for Alice');
                await TestUtils.getDataEvents(
                    alice.did.endpoints[0].preKey,
                    'DELETE',
                );

                // Send initial message to establish preferred endpoints
                logger.debug(
                    'Sending initial message to establish preferred endpoints',
                );
                const bobReceivedTextMessage = waitFor(
                    bob.messaging,
                    IM_CHAT_TEXT,
                );
                await alice.messaging.send(bob.did, new IMText('initial'));
                await bobReceivedTextMessage;

                // Verify Bob received through his endpoint
                logger.debug(
                    'Verifying Bob received message through his endpoint',
                );
                const bobEvents = await TestUtils.pollForDataEvent(
                    bob.did.endpoints[0].preKey,
                );
                expect(bobEvents.length).toBeGreaterThan(0);

                // Bob sends reply
                logger.debug('Bob sending reply through preferred endpoint');
                const reply = 'reply through preferred endpoint';
                const aliceReceivedTextMessage = waitFor(
                    alice.messaging,
                    IM_CHAT_TEXT,
                );
                await bob.messaging.send(alice.did, new IMText(reply));
                await aliceReceivedTextMessage;

                // Verify Alice received through her preferred endpoint
                logger.debug(
                    'Verifying Alice received reply through her preferred endpoint',
                );
                const aliceEvents = await TestUtils.pollForDataEvent(
                    alice.did.endpoints[0].preKey,
                );
                expect(
                    (aliceEvents as { endpoint: string }[]).some(
                        (event) => event.endpoint === secondarySocketServerUrl,
                    ),
                ).toBe(false);
            },
            TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT,
        );
    });
});
