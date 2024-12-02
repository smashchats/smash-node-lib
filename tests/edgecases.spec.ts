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

    describe('Alice sends multiple messages and they get delayed', () => {
        it('Bob receives them unordered and reorders them', async () => {
            const activateDelay = async () => {
                const url = `${socketServerUrl}/delay-next-5-messages`;
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
            const originalOrder = ['1', '2', '3', '4', '5'];
            const messageCount = originalOrder.length;
            const expectedReceivedOrder = ['1', '5', '4', '3', '2'];
            const waitForMessages = waitFor(
                bob!,
                'message',
                messageCount + protocolOverheadSize,
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
                await delay(50);
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
        }, 5000);
    });
});
