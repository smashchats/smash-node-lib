import {
    Logger,
    SignalSession,
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

    let dateSpy: jest.SpyInstance;

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
        bob.on('data', onBobMessageReceived);
    });

    afterEach(async () => {
        alice?.removeAllListeners();
        bob?.removeAllListeners();
        await alice!.close();
        await bob!.close();
        await delay(500);
        alice = undefined;
        bob = undefined;
        waitForEventCancelFns.forEach((cancel) => cancel());
        waitForEventCancelFns.length = 0;
        jest.resetAllMocks();
        if (dateSpy) dateSpy.mockRestore();
    });

    describe('Session recovery', () => {
        it('Session is automatically renewed after TTL', async () => {
            // 1. Alice sends a message to Bob
            const message1 = 'initial message';
            const waitForFirstMessage = waitFor(
                bob!,
                'data',
                1 + protocolOverheadSize,
            );
            await alice!.sendTextMessage(bobDID, message1, '0');
            await waitForFirstMessage;

            expect(onBobMessageReceived).toHaveBeenCalledWith(
                expect.objectContaining({ data: message1 }),
                expect.anything(),
            );

            // 2. Mock Date to simulate time passing beyond TTL
            // WARNING: this only works because the library uses Date.now() when comparing SESSION_TTL_MS
            dateSpy = jest
                .spyOn(Date, 'now')
                .mockImplementation(
                    () =>
                        new Date().getTime() +
                        SignalSession.SESSION_TTL_MS +
                        1000,
                );

            // 3. Simulate Bob restart with lost session context
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
            const newOnBobMessageReceived = jest.fn();
            bob.on('data', newOnBobMessageReceived);

            await delay(1000);

            // 4. Try sending another message
            const message2 = 'message after session expiry';
            const waitForSecondMessage = waitFor(
                bob!,
                'data',
                1 + protocolOverheadSize,
                6000,
            );

            await alice!.sendTextMessage(bobDID, message2, '0');
            await waitForSecondMessage;

            // 5. Verify message received
            expect(newOnBobMessageReceived).toHaveBeenCalledWith(
                expect.objectContaining({ data: message2 }),
                expect.anything(),
            );

            await delay(1000);
        }, 10000);

        it('Bob can recover communication after restart with lost session context', async () => {
            // 1. Initial communication
            const message1 = 'hello';
            const waitForFirstMessage = waitFor(
                bob!,
                'data',
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
            bob.on('data', newOnBobMessageReceived);
            const onAliceMessageReceived = jest.fn();
            alice!.on('data', onAliceMessageReceived);

            // 3. Alice tries to send another message
            const message2 = 'are you there?';
            const waitForSecondMessage = waitFor(
                bob!,
                'data',
                1 + protocolOverheadSize,
            );

            await alice!.sendTextMessage(bobDID, message2, '0');
            await waitForSecondMessage;

            expect(newOnBobMessageReceived).toHaveBeenCalledWith(
                expect.objectContaining({ data: message2 }),
                expect.anything(),
            );

            // 4. Bob tries to send another message to Alice
            const message3 = 'I am here!';
            const waitForThirdMessage = waitFor(alice!, 'data', 1);
            await delay(500);

            await bob!.sendTextMessage(aliceDID, message3, '0');
            await waitForThirdMessage;

            expect(onAliceMessageReceived).toHaveBeenCalledWith(
                expect.objectContaining({ data: message3 }),
                expect.anything(),
            );
        }, 10000);

        describe('Session reset race conditions', () => {
            it('handles simultaneous session resets gracefully', async () => {
                // 1. Initial communication to establish sessions
                const message1 = 'initial message';
                const waitForFirstMessage = waitFor(
                    bob!,
                    'data',
                    1 + protocolOverheadSize,
                );
                await alice!.sendTextMessage(bobDID, message1, '0');
                await waitForFirstMessage;

                const firstMessageCount = 1 + protocolOverheadSize;
                const secondMessageCount = 1 + protocolOverheadSize;
                const sessionResetCount = 1;
                expect(onBobMessageReceived).toHaveBeenCalledTimes(
                    firstMessageCount,
                );
                expect(onBobMessageReceived).toHaveBeenCalledWith(
                    expect.objectContaining({ data: message1 }),
                    expect.anything(),
                );

                // 2. Mock Date to simulate time near TTL for both peers
                // WARNING: this only works because the library uses Date.now() when comparing SESSION_TTL_MS
                dateSpy = jest
                    .spyOn(Date, 'now')
                    .mockImplementation(
                        () =>
                            new Date().getTime() +
                            SignalSession.SESSION_TTL_MS -
                            1000,
                    );

                // 3. Force both peers to trigger resets simultaneously
                // 3a. Close both peers
                const bobIdentity = await bob!.exportIdentityToJSON();
                await bob!.close();
                const aliceIdentity = await alice!.exportIdentityToJSON();
                await alice!.close();
                await delay(500);

                // 3b. Restart both peers
                bob = new SmashMessaging(
                    await SmashMessaging.deserializeIdentity(bobIdentity),
                    undefined,
                    'DEBUG',
                    'bob',
                );
                bob.on('data', onBobMessageReceived);
                alice = new SmashMessaging(
                    await SmashMessaging.deserializeIdentity(aliceIdentity),
                    undefined,
                    'DEBUG',
                    'alice',
                );
                await bob.initEndpoints([
                    {
                        url: socketServerUrl,
                        smePublicKey: 'smePublicKey==',
                    },
                ]);
                await alice.initEndpoints([
                    {
                        url: socketServerUrl,
                        smePublicKey: 'smePublicKey==',
                    },
                ]);
                await delay(1000);
                expect(onBobMessageReceived).toHaveBeenCalledTimes(
                    firstMessageCount,
                );

                // 3c. Init chats for both peers
                const currentTime = new Date().toISOString();
                const aliceResetPromise = alice!.initChats([
                    {
                        with: bobDID,
                        lastMessageTimestamp: currentTime,
                    },
                ]);
                const bobResetPromise = bob!.initChats([
                    {
                        with: aliceDID,
                        lastMessageTimestamp: currentTime,
                    },
                ]);

                await Promise.all([aliceResetPromise, bobResetPromise]);
                await delay(1000);

                expect(
                    onBobMessageReceived.mock.calls.length,
                ).toBeGreaterThanOrEqual(firstMessageCount + sessionResetCount);
                expect(
                    onBobMessageReceived.mock.calls.length,
                ).toBeLessThanOrEqual(
                    2 * firstMessageCount + sessionResetCount,
                );

                // 4. Verify communication still works
                const message2 = 'message after simultaneous reset';
                await alice!.sendTextMessage(bobDID, message2, '0');
                await delay(1000);

                expect(onBobMessageReceived).toHaveBeenCalledWith(
                    expect.objectContaining({ data: message2 }),
                    expect.anything(),
                );
                expect(
                    onBobMessageReceived.mock.calls.length,
                ).toBeGreaterThanOrEqual(
                    firstMessageCount + sessionResetCount + secondMessageCount,
                );
                expect(
                    onBobMessageReceived.mock.calls.length,
                ).toBeLessThanOrEqual(
                    2 * firstMessageCount +
                        sessionResetCount +
                        secondMessageCount,
                );
            }, 10000);
        });
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
            // const expectedReceivedOrder = ['1', '5', '4', '3', '2'];
            const waitForMessages = waitFor(
                bob!,
                'data',
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
            expect(textMessages.map((text) => text.data)).not.toEqual(
                originalOrder,
            );
            expect(
                sortSmashMessages(textMessages).map((text) => text.data),
            ).toEqual(originalOrder);
        }, 15000);
    });
});
