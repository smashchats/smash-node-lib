import { TestUtils } from '@tests/events.utils.js';
import { quietSocketServerUrl, socketServerUrl } from '@tests/jest.global.js';
import { TEST_CONFIG, delay } from '@tests/time.utils.js';
import { TestPeer, createPeer } from '@tests/user.utils.js';
import { Logger, SmashMessaging } from 'smash-node-lib';

describe('[Sessions] Session Management', () => {
    const logger = new Logger('sessions.spec', 'DEBUG');

    let alice: TestPeer;
    let bob: TestPeer;

    beforeAll(async () => {
        logger.info('Setting up crypto for tests');
        SmashMessaging.setCrypto(crypto);
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    });

    afterEach(async () => {
        logger.debug('Cleaning up test peers');
        await alice?.messaging.close();
        await bob?.messaging.close();
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    });

    describe('Session Reuse', () => {
        beforeEach(async () => {
            logger.debug('Creating test peers Alice and Bob');
            alice = await createPeer('alice', socketServerUrl);
            bob = await createPeer('bob', socketServerUrl);
            await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
        });

        it('should reuse the same session for subsequent messages', async () => {
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
            await delay(TEST_CONFIG.DEFAULT_POLL_INTERVAL);

            // Send first message to establish session
            logger.debug('Sending Alice->Bob message to establish session');
            const msg1 = await alice.messaging.sendTextMessage(
                bob.did,
                'msg1',
                '',
            );
            await delay(TEST_CONFIG.MESSAGE_DELIVERY);

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
            await delay(TEST_CONFIG.DEFAULT_POLL_INTERVAL);

            // Send second message
            logger.debug('Sending Bob->Alice message');
            await bob.messaging.sendTextMessage(alice.did, 'msg2', msg1.sha256);
            await delay(TEST_CONFIG.MESSAGE_DELIVERY);

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
        });
    });

    describe('Preferred Endpoint Management', () => {
        beforeEach(async () => {
            logger.debug(
                'Creating test peers Alice and Bob, Alice has two endpoints',
            );
            alice = await createPeer('alice', [
                socketServerUrl,
                quietSocketServerUrl,
            ]);
            bob = await createPeer('bob', socketServerUrl);
            await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
        });

        it('should establish and use preferred endpoints', async () => {
            logger.info('Testing preferred endpoint establishment and usage');

            // Clear existing events for both endpoints
            logger.debug('Clearing existing events for Alice');
            await TestUtils.getDataEvents(
                alice.did.endpoints[0].preKey,
                'DELETE',
            );
            await delay(TEST_CONFIG.DEFAULT_POLL_INTERVAL);

            // Send initial message to establish preferred endpoints
            logger.debug(
                'Sending initial message to establish preferred endpoints',
            );
            await alice.messaging.sendTextMessage(bob.did, 'initial', '');
            await delay(TEST_CONFIG.MESSAGE_DELIVERY);

            // Verify Bob received through his endpoint
            logger.debug('Verifying Bob received message through his endpoint');
            const bobEvents = await TestUtils.pollForDataEvent(
                bob.did.endpoints[0].preKey,
            );
            expect(bobEvents.length).toBeGreaterThan(0);

            // Bob sends reply
            logger.debug('Bob sending reply through preferred endpoint');
            const reply = 'reply through preferred endpoint';
            await bob.messaging.sendTextMessage(alice.did, reply, '');
            await delay(TEST_CONFIG.MESSAGE_DELIVERY);

            // Verify Alice received through her preferred endpoint
            logger.debug(
                'Verifying Alice received reply through her preferred endpoint',
            );
            const aliceEvents = await TestUtils.pollForDataEvent(
                alice.did.endpoints[0].preKey,
            );
            expect(
                (aliceEvents as { endpoint: string }[]).some(
                    (event) => event.endpoint === 'main',
                ),
            ).toBe(true);
            expect(aliceEvents.length).toBe(1);
        });
    });
});
