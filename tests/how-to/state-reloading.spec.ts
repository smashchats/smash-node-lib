import { Crypto } from '@peculiar/webcrypto';
import { TEST_CONFIG, aliasWaitFor, delay } from '@tests/utils/time.utils.js';
import {
    TestPeer,
    createPeer,
    restartTestPeer,
    startTestPeer,
    stopTestPeer,
} from '@tests/utils/user.utils.js';
import { socketServerUrl } from '@tests/vitest.sme-server.js';
import {
    IMText,
    IM_CHAT_TEXT,
    Logger,
    MessageStatusDelivered,
    SmashMessaging,
} from 'smash-node-lib';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

describe('Reloading Conversations with Pending Messages', () => {
    const logger = new Logger('state-reloading.spec', 'DEBUG');
    const waitForEventCancelFns: (() => void)[] = [];
    const waitFor = aliasWaitFor(waitForEventCancelFns, logger);
    let alice: TestPeer;
    let bob: TestPeer;

    beforeAll(() => {
        SmashMessaging.setCrypto(new Crypto());
    });

    beforeEach(async () => {
        [alice, bob] = await Promise.all([
            createPeer('alice', socketServerUrl),
            createPeer('bob', socketServerUrl),
        ]);
    }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);

    afterEach(async () => {
        await Promise.all([alice.messaging.close(), bob.messaging.close()]);
        waitForEventCancelFns.forEach((cancel) => cancel());
        waitForEventCancelFns.length = 0;
    }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);

    it('should reload conversations with pending messages', async () => {
        // Take Bob offline
        const { peerExportedIdentity, oldEndpoints } = await stopTestPeer(
            logger,
            bob,
        );

        // Alice sends a message to offline Bob
        const message = 'message for offline Bob';
        const sent = await alice.messaging.send(bob.did, new IMText(message));

        // Restart Alice
        alice = await restartTestPeer(logger, alice);

        // Bring Bob back online
        bob = await startTestPeer(
            logger,
            bob.name,
            peerExportedIdentity,
            oldEndpoints,
        );
        const bobReceivedMessage = waitFor(bob.messaging, IM_CHAT_TEXT, {
            timeout: TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT,
        });

        // Reload conversation with pending message
        await alice.messaging.initChats([
            {
                with: bob.did,
                pendingMessages: [sent],
            },
        ]);

        // Verify message delivery
        await bobReceivedMessage;
        expect(bob.onData).toHaveBeenCalledWith(
            alice.did.id,
            expect.objectContaining({ sha256: sent.sha256 }),
        );

        // Verify Alice received delivery confirmation
        await delay(TEST_CONFIG.MESSAGE_DELIVERY);
        expect(alice.onStatus).toHaveBeenCalledWith(
            MessageStatusDelivered,
            expect.arrayContaining([sent.sha256]),
        );
    });
});
