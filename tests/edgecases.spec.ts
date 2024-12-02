import {
    Logger,
    SmashDID,
    SmashMessaging,
    sortSmashMessages,
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

/**
 * **************************************************************
 *  Edge cases
 * **************************************************************
 */

async function createTestPeer(
    name: string,
    socketServerUrl?: string,
): Promise<SmashMessaging> {
    const [identity, config] = await peerArgs(socketServerUrl);
    const peer = new SmashMessaging(identity, undefined, 'DEBUG', name);
    await peer.initEndpoints(config);
    return peer;
}

describe('SmashMessaging: Edge cases', () => {
    const logger = new Logger('edgecases.spec');

    const waitForEventCancelFns: (() => void)[] = [];
    const waitFor = aliasWaitFor(waitForEventCancelFns, logger);

    let alice: SmashMessaging | undefined;
    let aliceDID: SmashDID;
    let bob: SmashMessaging | undefined;
    let bobDID: SmashDID;
    let onBobMessageReceived: jest.Mock;

    const protocolOverheadSize = 1;

    beforeAll(async () => {
        SmashMessaging.setCrypto(crypto);
        await delay(1000);
    });

    beforeEach(async () => {
        alice = await createTestPeer('alice', socketServerUrl);
        bob = await createTestPeer('bob', socketServerUrl);
        bobDID = await bob.getDID();
        aliceDID = await alice.getDID();
        onBobMessageReceived = jest.fn();
        bob.on('message', onBobMessageReceived);
    });

    afterEach(async () => {
        alice?.removeAllListeners();
        bob?.removeAllListeners();
        await alice!.close();
        await bob!.close();
        alice = undefined;
        bob = undefined;
        waitForEventCancelFns.forEach((cancel) => cancel());
        waitForEventCancelFns.length = 0;
        jest.resetAllMocks();
    });

    describe('Session recovery', () => {
        it('Session is automatically renewed after TTL', async () => {
            // 1. Alice sends a message to Bob
            // expect bob to receive the message
            // 2. Longer than EXPIRATION_TIME_MS elapses
            // simulate this by spying on the Date() constructor and Date.now() method
            // 3. Bob restart losing the context of sessions
            // expect bob to receive the new message
        });
        it('Bob can recover communication after restart with lost session context', async () => {
            // 1. Initial communication
            const message1 = 'hello';
            const waitForFirstMessage = waitFor(
                bob!,
                'message',
                1 + protocolOverheadSize,
            );
            await alice!.sendTextMessage(bobDID, message1, '0');
            await waitForFirstMessage;

            // Verify first message received
            expect(onBobMessageReceived).toHaveBeenCalledWith(
                expect.objectContaining({ data: message1 }),
                expect.anything(),
            );

            // 2. Simulate Bob restart - create new instance with same identity
            const bobIdentity = await bob!.exportIdentityToJSON();
            await bob!.close();
            bob = new SmashMessaging(
                await SmashMessaging.deserializeIdentity(bobIdentity),
                undefined,
                'DEBUG',
                'bob',
            );
            await bob.initEndpoints([
                {
                    url: socketServerUrl,
                    smePublicKey: 'smePublicKey==',
                },
            ]);
            await bob.initChats([
                {
                    with: aliceDID,
                    lastMessageTimestamp: new Date().toISOString(),
                },
            ]);
            const newOnBobMessageReceived = jest.fn();
            bob.on('message', newOnBobMessageReceived);

            // 3. Alice tries to send another message
            const message2 = 'are you there?';
            const waitForSecondMessage = waitFor(
                bob!,
                'message',
                1 + protocolOverheadSize,
            );

            await alice!.sendTextMessage(bobDID, message2, '0');
            await waitForSecondMessage;

            expect(newOnBobMessageReceived).toHaveBeenCalledWith(
                expect.objectContaining({ data: message2 }),
                expect.anything(),
            );
        }, 10000);
    });

    describe('Alice sends multiple messages and they get delayed', () => {
        it('Bob receives them unordered and reorders them', async () => {
            const activateDelay = async () => {
                const url = `${socketServerUrl}/delay-next-messages?peerId=${encodeURIComponent(bobDID.endpoints[0].preKey)}`;
                try {
                    const response = await fetch(url);
                    if (!response.ok) {
                        logger.error(
                            `Error response: ${await response.text()}`,
                        );
                        throw new Error(
                            `HTTP error! status: ${response.status}`,
                        );
                    }
                    return;
                } catch (error) {
                    logger.error('Fetch error:', error);
                    throw error;
                }
            };
            await activateDelay();
            await delay(500);
            const originalOrder = ['1', '2', '3', '4', '5'];
            const messageCount = originalOrder.length;
            const expectedReceivedOrder = ['1', '5', '4', '3', '2'];
            const waitForMessages = waitFor(
                bob!,
                'message',
                messageCount + protocolOverheadSize,
                10000,
            );
            let prevSha256: string = '0';
            for (let i = 0; i < messageCount; i++) {
                prevSha256 = (
                    await alice!.sendTextMessage(
                        bobDID,
                        originalOrder[i],
                        prevSha256,
                    )
                ).sha256;
                await delay(100);
            }
            await waitForMessages;
            const receivedMessages = onBobMessageReceived.mock.calls.map(
                ([message]) => message,
            );
            const textMessages = receivedMessages.filter(
                (message) => message.type === 'text',
            );
            expect(textMessages.length).toBe(messageCount);
            expect(textMessages.map((text) => text.data)).toEqual(
                expectedReceivedOrder,
            );
            expect(
                sortSmashMessages(textMessages).map((text) => text.data),
            ).toEqual(originalOrder);
        }, 15000);
    });
});
