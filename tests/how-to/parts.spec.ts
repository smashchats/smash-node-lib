import { Crypto } from '@peculiar/webcrypto';
import {
    IM_CHAT_TEXT,
    IM_MEDIA_EMBEDDED,
} from '@src/shared/lexicon/improto.lexicon.js';
import { IMMediaEmbedded } from '@src/shared/types/messages/IMMediaEmbeddedMessage.js';
import { IMText } from '@src/shared/types/messages/IMTextMessage.js';
import { socketServerUrl } from '@tests/jest.global.js';
import { TEST_CONFIG, aliasWaitFor, delay } from '@tests/utils/time.utils.js';
import { TestPeer, createPeer } from '@tests/utils/user.utils.js';
import { IMProtoMessage, Logger, SmashMessaging } from 'smash-node-lib';

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

    beforeAll(async () => {
        const crypto = new Crypto();
        SmashMessaging.setCrypto(crypto);
    });

    afterEach(async () => {
        logger.debug('>> canceling all waiters');
        await Promise.all(waitForEventCancelFns.map((cancel) => cancel()));
        waitForEventCancelFns.length = 0;
        logger.debug('>> resetting mocks');
        jest.resetAllMocks();
    });

    afterAll(async () => {
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    });

    describe('Message size limits', () => {
        test('Messages under size limit are not split', async () => {
            const smallText = 'Hello '.repeat(1000); // ~6KB
            const message = new IMText(smallText);
            const messageJson = JSON.stringify(message);

            expect(messageJson.length).toBeLessThan(512 * 1024); // 512KB
        });

        test('Messages over size limit are split', async () => {
            const largeText = 'Hello '.repeat(200000); // ~750KB
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
            // Create a large text message (>512KB)
            const largeText = 'Hello '.repeat(200000); // ~750KB
            const message = new IMText(largeText);

            const onBobMessage = jest.fn();
            bob.messaging.on(IM_CHAT_TEXT, onBobMessage);

            const bobReceivedMessage = waitFor(bob.messaging, IM_CHAT_TEXT);

            const sent = await alice.messaging.send(bob.did, message);
            await bobReceivedMessage;

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
        });

        test('Sending a large media message', async () => {
            // Create a large media message (>512KB)
            const largeContent = new Uint8Array(600 * 1024); // 600KB
            const message = IMMediaEmbedded.fromUint8Array(
                largeContent,
                'application/octet-stream',
                'Large file',
            );

            const onBobMessage = jest.fn();
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
