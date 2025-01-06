import { Crypto } from '@peculiar/webcrypto';
import {
    SME_PUBLIC_KEY,
    apiServerUrl,
    socketServerUrl,
} from '@tests/jest.global.js';
import { TEST_CONFIG, aliasWaitFor, delay } from '@tests/utils/time.utils.js';
import { TestPeer, createPeer } from '@tests/utils/user.utils.js';
import {
    EncapsulatedIMProtoMessage,
    IMProtoMessage,
    IMText,
    IMTextMessage,
    IM_CHAT_TEXT,
    Logger,
    SESSION_TTL_MS,
    SmashMessaging,
    sha256,
    sortSmashMessages,
} from 'smash-node-lib';

// TODO: import config on lib loading (& add to tutorial)
const restartTestPeer = async (logger: Logger, peer: TestPeer) => {
    logger.debug('>> Exporting peer identity');
    const peerExportedIdentity = await peer.messaging.exportIdentity();
    logger.debug('> Exported', JSON.stringify(peerExportedIdentity, null, 2));

    logger.debug('>> Closing peer messaging');
    await peer.messaging.close();
    await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);

    logger.debug('>> Importing peer identity');
    const peerIdentity =
        await SmashMessaging.importIdentity(peerExportedIdentity);
    logger.debug(
        '> Imported',
        JSON.stringify(await peerIdentity.serialize(), null, 2),
    );

    logger.debug('>> Creating restarted peer');
    const restartedPeer = await createPeer(
        `${peer.name} (after restart)`,
        [],
        peerIdentity,
    );
    const peerEndpointsReconfig = peer.did.endpoints.map((endpoint, index) => ({
        ...endpoint,
        smePublicKey: SME_PUBLIC_KEY,
        preKeyPair: peer.identity.signedPreKeys[index],
    }));
    await restartedPeer.messaging.endpoints.reset(peerEndpointsReconfig);
    return restartedPeer;
};

// TODO: refactor test suite into How To guides generation material

/**
 * **************************************************************
 *  Edge cases
 * **************************************************************
 */
describe('SmashMessaging: Edge cases', () => {
    const logger = new Logger('edgecases.spec', 'DEBUG');
    const waitForEventCancelFns: (() => void)[] = [];
    const waitFor = aliasWaitFor(waitForEventCancelFns, logger);
    let alice: TestPeer | undefined;
    let bob: TestPeer | undefined;
    let dateSpy: jest.SpyInstance;

    beforeAll(async () => {
        const crypto = new Crypto();
        SmashMessaging.setCrypto(crypto);
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    });

    beforeEach(async () => {
        alice = await createPeer('alice', socketServerUrl);
        bob = await createPeer('bob', socketServerUrl);
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    }, TEST_CONFIG.TEST_TIMEOUT_MS * 2);

    afterEach(async () => {
        await alice?.messaging.close();
        await bob?.messaging.close();
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
        waitForEventCancelFns.forEach((cancel) => cancel());
        waitForEventCancelFns.length = 0;
        jest.resetAllMocks();
        dateSpy?.mockRestore();
    });

    describe('Session recovery', () => {
        it(
            'Session is automatically renewed after TTL',
            async () => {
                if (!bob || !alice) throw new Error('Bob or Alice not found');
                logger.info('>>> Session is automatically renewed after TTL');

                // 1. Alice sends a message to Bob
                logger.info('>> Alice sends a message to Bob');
                const bobReceivedFirstMessage = waitFor(
                    bob.messaging,
                    IM_CHAT_TEXT,
                );
                const message1 = 'initial message';
                const sent = await alice.messaging.send(
                    bob.did,
                    new IMText(message1),
                );
                await bobReceivedFirstMessage;

                logger.info('>> Verify Bob received the message');
                expect(bob.onData).toHaveBeenCalledWith(
                    alice.did.id,
                    expect.objectContaining({ sha256: sent.sha256 }),
                );

                logger.info('>> Verify Alice received the ACK');
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                expect(alice.onStatus).toHaveBeenCalledWith(
                    'delivered',
                    expect.arrayContaining([sent.sha256]),
                );

                // 2. Mock Date to simulate time passing beyond TTL
                // WARNING: this only works because the library uses Date.now() when comparing SESSION_TTL_MS
                logger.info('>> Mock Date to simulate time passing beyond TTL');
                dateSpy = jest
                    .spyOn(Date, 'now')
                    .mockImplementation(
                        () => new Date().getTime() + SESSION_TTL_MS + 1000,
                    );

                // 3. Simulate Bob restart with lost session context
                logger.info(
                    '>> Simulate Bob restart with lost session context',
                );
                bob = await restartTestPeer(logger, bob);
                if (!bob) throw new Error('Bob not found');

                // 4. Try sending another message
                logger.info('>> Try sending another message');
                const bobReceivedSecondMessage = waitFor(
                    bob.messaging,
                    IM_CHAT_TEXT,
                    { timeout: TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT },
                );
                const message2 = 'message after session expiry';
                const sent2 = await alice.messaging.send(
                    await bob.messaging.getDIDDocument(),
                    new IMText(message2),
                );
                await bobReceivedSecondMessage;

                // 5. Verify message received
                logger.info('>> Verify Bob received the second message');
                expect(bob.onData).toHaveBeenCalledWith(
                    alice.did.id,
                    expect.objectContaining({ sha256: sent2.sha256 }),
                );

                logger.info('>> Verify Alice received the ACK');
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                expect(alice.onStatus).toHaveBeenCalledWith(
                    'received',
                    expect.arrayContaining([sent2.sha256]),
                );

                logger.info('>> Cleanup');
                await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
            },
            TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT,
        );

        it(
            'Bob can recover communication after restart with lost session context',
            async () => {
                if (!bob || !alice) throw new Error('Bob or Alice not found');
                logger.info(
                    '>>> Bob can recover communication after restart with lost session context',
                );

                // 1. Initial communication
                logger.info('>> Alice sends a first message to Bob');
                const bobReceivedFirstMessage = waitFor(
                    bob.messaging,
                    IM_CHAT_TEXT,
                );
                const sent1 = await alice.messaging.send(
                    bob.did,
                    new IMText('hello'),
                );
                await bobReceivedFirstMessage;

                // Verify first message received
                logger.info('>> Verify first message received');
                expect(bob.onData).toHaveBeenCalledWith(
                    alice.did.id,
                    expect.objectContaining({ sha256: sent1.sha256 }),
                );

                // 2. Simulate Bob restart - create new instance with same identity
                logger.info('>> Simulate Bob restart');
                bob = await restartTestPeer(logger, bob);
                if (!bob) throw new Error('Bob not found');

                logger.info('>> Init chats for Bob');
                await bob.messaging.initChats([
                    {
                        with: alice.did,
                        lastMessageTimestamp: new Date().toISOString(),
                    },
                ]);

                await delay(TEST_CONFIG.MESSAGE_DELIVERY);

                // 3. Alice tries to send another message
                logger.info('>> Alice tries to send another message to Bob');
                const bobReceivedSecondMessage = waitFor(
                    bob.messaging,
                    IM_CHAT_TEXT,
                    { timeout: TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT },
                );
                const message2 = 'are you there?';
                const sent2 = await alice.messaging.send(
                    bob.did,
                    new IMText(message2),
                );
                await bobReceivedSecondMessage;

                logger.info('>> Verify Bob received the second message');
                expect(bob.onData).toHaveBeenCalledWith(
                    alice.did.id,
                    expect.objectContaining({ sha256: sent2.sha256 }),
                );

                // 4. Bob tries to send another message to Alice
                logger.info('>> Bob tries to send a reply message to Alice');
                const aliceReceivedReplyMessage = waitFor(
                    alice.messaging,
                    IM_CHAT_TEXT,
                    { timeout: TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT },
                );
                const message3 = 'I am here!';
                const sent3 = await bob.messaging.send(
                    alice.did,
                    new IMText(message3),
                );
                await aliceReceivedReplyMessage;

                logger.info('>> Verify Alice received the reply message');
                expect(alice.onData).toHaveBeenCalledWith(
                    bob.did.id,
                    expect.objectContaining({ sha256: sent3.sha256 }),
                );

                logger.info('>> Cleanup');
                await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
            },
            TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT,
        );

        describe('Session reset race conditions', () => {
            it(
                'handles simultaneous session resets gracefully',
                async () => {
                    if (!bob || !alice)
                        throw new Error('Bob or Alice not found');
                    logger.info(
                        '>>> handles simultaneous session resets gracefully',
                    );

                    // 1. Initial communication to establish sessions
                    logger.info('>> Alice sends message1 to Bob');
                    const bobReceivedFirstMessage = waitFor(
                        bob.messaging,
                        IM_CHAT_TEXT,
                    );
                    const message1 = 'initial message';
                    // count (on Bob end):
                    // - Alice profile message to bob
                    // - Alice message1 to bob
                    // - Alice's ACK of Bob's profile message
                    const firstMessageCount =
                        1 + 2 * TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE;
                    const sent1 = await alice.messaging.send(
                        bob.did,
                        new IMText(message1),
                    );
                    await bobReceivedFirstMessage;

                    logger.info(
                        `>> Verify Bob received the message (and no more messages than expected (${firstMessageCount}))`,
                    );
                    expect(bob.onData).toHaveBeenCalledWith(
                        alice.did.id,
                        expect.objectContaining({ sha256: sent1.sha256 }),
                    );
                    expect(bob.onData.mock.calls.length).toBeLessThanOrEqual(
                        firstMessageCount,
                    );
                    bob.onData.mockClear();

                    // 2. Mock Date to simulate time near TTL for both peers
                    // WARNING: this only works because the library uses Date.now() when comparing SESSION_TTL_MS
                    logger.info(
                        '>> Mock Date to simulate time near TTL for both peers',
                    );
                    dateSpy = jest
                        .spyOn(Date, 'now')
                        .mockImplementation(
                            () => new Date().getTime() + SESSION_TTL_MS - 1000,
                        );

                    // 3. Force both peers to trigger resets simultaneously
                    // 3a. Restarting both peers
                    logger.info('>> Restarting both peers');
                    [alice, bob] = await Promise.all([
                        restartTestPeer(logger, alice),
                        restartTestPeer(logger, bob),
                    ]);

                    if (!bob || !alice)
                        throw new Error('Bob or Alice not found');

                    // 3b. Init chats for both peers
                    logger.info(
                        '>> Init chats for both peers (= triggering parallel SESSION RESET)',
                    );
                    const currentTime = new Date().toISOString();
                    await Promise.all([
                        alice.messaging.initChats([
                            {
                                with: bob.did,
                                lastMessageTimestamp: currentTime,
                            },
                        ]),
                        bob.messaging.initChats([
                            {
                                with: alice.did,
                                lastMessageTimestamp: currentTime,
                            },
                        ]),
                    ]);
                    await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);

                    logger.info('>> Wait for both peers to reset');
                    await delay(4 * TEST_CONFIG.MESSAGE_DELIVERY);

                    // expected calls on Bob end:
                    // - Alice profile message to Bob
                    // - Alice session reset message to Bob
                    // - Alice's ACK of Bob's profile message
                    // - Alice's ACK of Bob's session reset message
                    const sessionResetCount =
                        (1 + TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE) * 2;
                    // TODO: FIX (+ 2*firstMessageCount because queue isnt emptied + re-ACKs)
                    const expectedCalls =
                        2 * firstMessageCount + sessionResetCount;
                    logger.info(
                        `>> Verify Bob didnt receive more messages than expected (${bob.onData.mock.calls.length}/${expectedCalls})`,
                    );
                    expect(bob.onData.mock.calls.length).toBeLessThanOrEqual(
                        expectedCalls,
                    );
                    bob.onData.mockClear();

                    // 4. Verify communication still works
                    logger.info('>> Alice sends message to Bob after reset');
                    const bobReceivedSecondMessage = waitFor(
                        bob.messaging,
                        IM_CHAT_TEXT,
                        { timeout: TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT },
                    );
                    const message2 = 'message after simultaneous reset';
                    const sent2 = await alice.messaging.send(
                        bob.did,
                        new IMText(message2),
                    );
                    await bobReceivedSecondMessage;

                    const secondMessageCount = 1;
                    logger.info('>> Verify Bob received the second message');
                    expect(bob.onData).toHaveBeenCalledWith(
                        alice.did.id,
                        expect.objectContaining({ sha256: sent2.sha256 }),
                    );

                    logger.info(
                        `>> Verify Bob didnt receive more messages than expected (${bob.onData.mock.calls.length}/${secondMessageCount})`,
                    );
                    expect(bob.onData.mock.calls.length).toBeLessThanOrEqual(
                        secondMessageCount * 2,
                    );

                    logger.info('>> Cleanup');
                    await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
                },
                TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT * 3,
            );
        });
    });

    describe('Alice sends multiple messages and they get delayed', () => {
        it('Bob receives them unordered and reorders them', async () => {
            if (!bob || !alice) throw new Error('Bob or Alice not found');
            logger.info(
                '>>> Bob receives unordered messages and reorders them',
            );

            const activateDelay = async () => {
                logger.info('>> Activating delay on the mocked SME');
                if (!bob) throw new Error('Bob not found');
                const url = `${apiServerUrl}/delay-next-messages?peerId=${encodeURIComponent(bob.did.endpoints[0].preKey)}`;
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
            const waitForMessages = waitFor(bob.messaging, 'data', {
                count: messageCount + TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE,
                timeout: TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT,
            });

            logger.info(`>> Alice sends ${messageCount} messages to Bob`);
            let prevSha256: string = '0';
            for (let i = 0; i < messageCount; i++) {
                prevSha256 = (
                    await alice.messaging.send(
                        bob.did,
                        new IMText(originalOrder[i], prevSha256 as sha256),
                    )
                ).sha256;
                await delay(100);
            }

            logger.info('>> Wait for messages to be received');
            await waitForMessages;
            await delay(3 * TEST_CONFIG.MESSAGE_DELIVERY);
            logger.info('>> Received messages');

            const receivedMessages = bob.onData.mock.calls.map(
                (args: EncapsulatedIMProtoMessage[]) => args[1],
            );
            const textMessages = receivedMessages.filter(
                (message: IMProtoMessage) => message.type === IM_CHAT_TEXT,
            );

            logger.info('>> Verify the order of the messages');
            expect(textMessages.length).toBe(messageCount);
            expect(
                (
                    textMessages.filter(
                        (message: IMProtoMessage) =>
                            message.type === IM_CHAT_TEXT,
                    ) as IMTextMessage[]
                ).map((text: IMTextMessage) => text.data),
            ).not.toEqual(originalOrder);
            expect(
                sortSmashMessages(textMessages).map((text) => text.data),
            ).toEqual(originalOrder);

            logger.info('>> Cleanup');
            await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
        }, 15000);
    });
});
