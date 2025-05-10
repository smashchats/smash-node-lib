import { Crypto } from '@peculiar/webcrypto';
import { TEST_CONFIG, aliasWaitFor, delay } from '@tests/utils/time.utils.js';
import { TestPeer, createPeer } from '@tests/utils/user.utils.js';
import { socketServerUrl } from '@tests/vitest.sme-server.js';
import {
    IMMediaEmbedded,
    IMProtoMessage,
    IMText,
    IM_CHAT_TEXT,
    IM_MEDIA_EMBEDDED,
    Logger,
    MAX_MESSAGE_SIZE,
    SmashMessaging,
} from 'smash-node-lib';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from 'vitest';

/**
 * @tutorial-meta
 * title: Message Splitting
 * framework: Diataxis
 * type: How-To
 * description: Learn how to handle large messages that exceed the size limit by splitting them into parts
 */
describe('Message Splitting', () => {
    const logger = new Logger('parts.spec', 'DEBUG');
    const waitForEventCancelFns: (() => void)[] = [];
    const waitFor = aliasWaitFor(waitForEventCancelFns, logger);

    const smallText = 'Hello '.repeat(1000); // ~6KB
    const largeText = 'Hello '.repeat(MAX_MESSAGE_SIZE / 3); // Over 512KB

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

    describe('Message size limits', () => {
        test('Messages under size limit are not split', async () => {
            const message = new IMText(smallText);
            const messageJson = JSON.stringify(message);

            expect(messageJson.length).toBeLessThan(512 * 1024); // 512KB
        });

        test('Messages over size limit are split', async () => {
            const message = new IMText(largeText);
            const messageJson = JSON.stringify(message);

            expect(messageJson.length).toBeGreaterThan(512 * 1024); // 512KB
        });
    });

    describe('Sending large messages', () => {
        let alice: TestPeer;
        let bob: TestPeer;

        beforeEach(async () => {
            alice = await createPeer('alice', socketServerUrl);
            bob = await createPeer('bob', socketServerUrl);
        }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);

        afterEach(async () => {
            await alice?.messaging.close();
            await bob?.messaging.close();
        }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);

        test('Sending a large text message', async () => {
            const message = new IMText(largeText);

            const onBobMessage = vi.fn();
            bob.messaging.on(IM_CHAT_TEXT, onBobMessage);

            const onAliceStatus = vi.fn();
            alice.messaging.on('status', onAliceStatus);

            const bobReceivedMessage = waitFor(bob.messaging, IM_CHAT_TEXT);

            // Alice sends an oversized message to Bob
            const sent = await alice.messaging.send(bob.did, message);
            await bobReceivedMessage;

            // Bob receives the original message and it is correctly handled
            expect(onBobMessage).toHaveBeenCalledWith(
                alice.did.id,
                expect.objectContaining<IMProtoMessage>({
                    type: IM_CHAT_TEXT,
                    data: largeText,
                    sha256: sent.sha256,
                    timestamp: sent.timestamp,
                    after: sent.after,
                }),
            );

            await delay(TEST_CONFIG.MESSAGE_DELIVERY);

            // Alice receives a delivered ACK for the original message
            expect(onAliceStatus).toHaveBeenCalledWith(
                'delivered',
                expect.arrayContaining([sent.sha256]),
            );

            // Alice receives a received ACK for the original message
            expect(onAliceStatus).toHaveBeenCalledWith(
                'received',
                expect.arrayContaining([sent.sha256]),
            );
        });

        test('Sending a large media message', async () => {
            const largeContent = new Uint8Array(2 * MAX_MESSAGE_SIZE);
            const message = IMMediaEmbedded.fromUint8Array(
                largeContent,
                'application/octet-stream',
                'Large file',
            );

            const onBobMessage = vi.fn();
            bob.messaging.on(IM_MEDIA_EMBEDDED, onBobMessage);

            const bobReceivedMessage = waitFor(
                bob.messaging,
                IM_MEDIA_EMBEDDED,
            );
            const sent = await alice.messaging.send(bob.did, message);
            await bobReceivedMessage;

            expect(onBobMessage).toHaveBeenCalledWith(
                alice.did.id,
                expect.objectContaining<IMProtoMessage>({
                    type: IM_MEDIA_EMBEDDED,
                    data: expect.objectContaining({
                        mimeType: 'application/octet-stream',
                        content: expect.any(String),
                        alt: 'Large file',
                    }),
                    sha256: sent.sha256,
                    timestamp: sent.timestamp,
                    after: sent.after,
                }),
            );
        });
    });
});
