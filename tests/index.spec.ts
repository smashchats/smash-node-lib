import { Buffer } from 'buffer';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    EncapsulatedSmashMessage,
    Logger,
    SmashDID,
    SmashMessaging,
    sortSmashMessages,
} from 'smash-node-lib';
import { Server, Socket } from 'socket.io';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { aliasWaitFor, delay } from './time.utils';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { peerArgs } from './user.utils';

/**
 * **************************************************************
 *  tests generic to all Smash Peers
 * **************************************************************
 */

// TODO use case with only one peer configured with SME
// describe('Only Bob is registered to an SME.', () => {

async function createTestPeer(
    name: string,
    socketServerUrl?: string,
): Promise<SmashMessaging> {
    const [identity, config] = await peerArgs(socketServerUrl);
    const peer = new SmashMessaging(identity, undefined, 'DEBUG', name);
    await peer.initEndpoints(config);
    return peer;
}

const ISO8601_TIMESTAMP_REGEX =
    /^(?<year>-?(?:[1-9][0-9]*)?[0-9]{4})-(?<month>1[0-2]|0[1-9])-(?<day>3[01]|0[1-9]|[12][0-9])T(?<hour>2[0-3]|[01][0-9]):(?<minute>[0-5][0-9]):(?<second>[0-5][0-9])(?:\.(?<ms>[0-9]+))?(?<timezone>Z|[+-](?:2[0-3]|[01][0-9]):[0-5][0-9])$/;

// TODO Consider running Jest with `--detectOpenHandles`
// TODO Review coverage

describe('SmashMessaging: Between peers registered to a SME', () => {
    const waitForEventCancelFns: (() => void)[] = [];
    const waitFor = aliasWaitFor(
        waitForEventCancelFns,
        new Logger('index.spec'),
    );

    let ioServer: Server;
    let RealDate: DateConstructor;
    let mockedNow: Date;
    let socketServerUrl = '';
    const activeSockets: Socket[] = [];
    let handleServerData: (
        socket: Socket,
        peerId: string,
        sessionId: string,
        data: ArrayBuffer,
    ) => Promise<void>;
    let onSMEDataEvent: jest.Mock<void, [string, string, ArrayBuffer]>;
    const serverReceivedMessages: Promise<void>[] = [];
    let bothConnectedToSME: Promise<void>;

    let alice: SmashMessaging | undefined;
    let bob: SmashMessaging | undefined;
    let bobDID: SmashDID;
    let aliceDID: SmashDID;
    let onBobMessageReceived: jest.Mock;
    let onAliceMessageReceived: jest.Mock;
    let onBobStatusUpdated: jest.Mock;
    let onAliceStatusUpdated: jest.Mock;

    // additional Smash messages automatically included in a session
    const protocolOverheadSize = 1;

    beforeAll((done) => {
        RealDate = Date;
        mockedNow = new RealDate('2024-01-01T00:00:00.000Z');
        global.Date = class extends RealDate {
            constructor() {
                super();
                return mockedNow;
            }
        } as DateConstructor;
        const httpServer = createServer();
        ioServer = new Server(httpServer);
        ioServer.on('connection', async (client: Socket) => {
            activeSockets.push(client);
            serverReceivedMessages.push(waitFor(client, 'data'));
            client.on('data', async (peerId, sessionId, data, acknowledge) => {
                await handleServerData(client, peerId, sessionId, data);
                acknowledge();
            });
        });
        httpServer.listen(() => {
            const port = (httpServer.address() as AddressInfo).port;
            socketServerUrl = `http://localhost:${port}`;
            setTimeout(done, 500);
        });
        SmashMessaging.setCrypto(crypto);
    });

    afterAll(() => {
        ioServer.close();
        global.Date = Date;
    });

    beforeEach(async () => {
        jest.spyOn(Date, 'now').mockImplementation(() => mockedNow.getTime());

        onSMEDataEvent = jest.fn();
        handleServerData = async (socket, peerId, sessionId, data) => {
            onSMEDataEvent(peerId, sessionId, data);
            activeSockets
                .filter((client) => client.id !== socket.id)
                .forEach((client) => client.emit('data', sessionId, data));
        };
        bothConnectedToSME = waitFor(ioServer, 'connection', 2);
        alice = await createTestPeer('alice', socketServerUrl);
        bob = await createTestPeer('bob', socketServerUrl);
        bobDID = await bob.getDID();
        aliceDID = await alice.getDID();
        onBobMessageReceived = jest.fn();
        onBobStatusUpdated = jest.fn();
        bob.on('status', onBobStatusUpdated);
        bob.on('message', onBobMessageReceived);
        onAliceMessageReceived = jest.fn();
        onAliceStatusUpdated = jest.fn();
        alice.on('status', onAliceStatusUpdated);
        alice.on('message', onAliceMessageReceived);
    });

    afterEach(async () => {
        await alice!.close();
        await bob!.close();
        alice = undefined;
        bob = undefined;
        waitForEventCancelFns.forEach((cancel) => cancel());
        waitForEventCancelFns.length = 0;
        activeSockets.forEach((socket) => socket.disconnect(true));
        activeSockets.length = 0;
        serverReceivedMessages.length = 0;
        jest.resetAllMocks();
    });

    describe('Alice updates their profile metadata BEFORE chatting with Bob', () => {
        it('Bob doesnt receive the update', async () => {
            const updatedMeta = {
                title: 'Alice',
                description: 'Alice is a cool person',
                picture: 'https://alice.com/picture.png',
            };
            await alice!.updateMeta(updatedMeta);
            await delay(500);
            expect(onBobMessageReceived).not.toHaveBeenCalled();
        });
    });

    describe('Alice sends one message to Bob', () => {
        const messageText = 'hello world 1';
        const messageSha256 = 'i1M92vd0lSfaQxVb3V018uMwghFYNd6xyWujvdUA+/Y=';
        let aliceSentMessage: EncapsulatedSmashMessage;
        let bobReceivedMessage: Promise<void>;

        beforeEach(async () => {
            bobReceivedMessage = waitFor(
                bob!,
                'message',
                1 + protocolOverheadSize,
            );
            aliceSentMessage = await alice!.sendTextMessage(
                bobDID,
                messageText,
                '0',
            );
        });

        it("delivers the initial message to Bob's declared SME", async () => {
            await delay(200); // give Alice some time to connect to SME
            await Promise.race(serverReceivedMessages);
            await delay(50); // give Alice some time to process ack
            expect(onSMEDataEvent).toHaveBeenCalledTimes(1);
            expect(onSMEDataEvent).toHaveBeenCalledWith(
                bobDID.endpoints[0].preKey,
                expect.any(String),
                expect.any(Buffer),
            );
            expect(onAliceStatusUpdated).toHaveBeenCalledWith(
                messageSha256,
                'delivered',
            );
        });

        it('contains a content-addressable ID', async () => {
            expect(aliceSentMessage).toMatchObject({
                sha256: messageSha256,
            } as EncapsulatedSmashMessage);
        });

        it('contains a valid timestamp', async () => {
            const precision = 1000; // s precision
            const nowTime = mockedNow.getTime() / precision;
            expect(aliceSentMessage).toMatchObject({
                timestamp: expect.stringMatching(ISO8601_TIMESTAMP_REGEX),
            } as EncapsulatedSmashMessage);
            const messageTime =
                new Date(aliceSentMessage.timestamp).getTime() / precision;
            expect(messageTime).toBeCloseTo(nowTime, 0);
        });

        describe('Alice updates their profile metadata AFTER chatting with Bob', () => {
            it('Bob receives the update', async () => {
                const updatedMeta = {
                    title: 'Alice',
                    description: 'Alice is a cool person',
                    picture: 'https://alice.com/picture.png',
                };
                await alice!.updateMeta(updatedMeta);
                await delay(500);
                expect(onBobMessageReceived).toHaveBeenCalledWith(
                    expect.objectContaining({
                        data: expect.objectContaining({
                            meta: updatedMeta,
                        }),
                    }),
                    expect.anything(),
                );
            });
        });

        describe('then Bob', () => {
            beforeEach(async () => {
                await bothConnectedToSME;
                await bobReceivedMessage;
            });

            it('receives the message once', async () => {
                // receives the message + DID (protocol overhead)
                expect(onBobMessageReceived).toHaveBeenCalledTimes(
                    1 + protocolOverheadSize,
                );
            });

            it('can decrypt the message content', async () => {
                expect(onBobMessageReceived).toHaveBeenCalledWith(
                    expect.objectContaining({
                        data: aliceSentMessage.data,
                    } as EncapsulatedSmashMessage),
                    expect.anything(),
                );
            });

            it('knows Alice identity (DID)', async () => {
                expect(onBobMessageReceived).toHaveBeenCalledWith(
                    expect.anything(),
                    // TODO: profile?
                    expect.objectContaining({
                        ik: aliceDID.ik,
                        ek: aliceDID.ek,
                        endpoints: aliceDID.endpoints,
                    } as SmashDID),
                );
            });

            it('successfully replies to Alice', async () => {
                const bobReplyText = 'hello back';
                const lastMessage = onBobMessageReceived.mock.lastCall[0];
                const receivedAliceDID = onBobMessageReceived.mock.lastCall[1];
                jest.resetAllMocks();
                const aliceReceivedReply = waitFor(alice!, 'message');
                await bob!.sendTextMessage(
                    receivedAliceDID,
                    bobReplyText,
                    lastMessage.sha256,
                );
                await aliceReceivedReply;
                expect(onAliceMessageReceived).toHaveBeenCalledWith(
                    expect.objectContaining({
                        data: bobReplyText,
                    }),
                    expect.anything(),
                );
            });
        });
    });

    describe('Three users registered to the same SME', () => {
        let charlie: SmashMessaging | undefined;
        // let charlieDID: SmashDID;
        let onCharlieMessageReceived: jest.Mock;
        let onCharlieStatusUpdated: jest.Mock;

        beforeEach(async () => {
            const charlieConnected = waitFor(ioServer, 'connection');
            charlie = await createTestPeer('charlie', socketServerUrl);
            // charlieDID = await charlie.getDID();
            onCharlieMessageReceived = jest.fn();
            onCharlieStatusUpdated = jest.fn();
            charlie.on('status', onCharlieStatusUpdated);
            charlie.on('message', onCharlieMessageReceived);
            await charlieConnected;
        });

        afterEach(async () => {
            await charlie!.close();
            charlie = undefined;
        });

        it('Alice and Bob can message each other without errors while Charlie is connected', async () => {
            const aliceToBobMessage = 'Hello Bob!';
            const bobToAliceMessage = 'Hi Alice!';

            const bobReceivedMessage = waitFor(
                bob!,
                'message',
                1 + protocolOverheadSize,
            );
            const aliceReceivedMessage = waitFor(
                alice!,
                'message',
                1 + protocolOverheadSize,
            );

            // Alice sends a message to Bob
            const aliceSentMessage = await alice!.sendTextMessage(
                bobDID,
                aliceToBobMessage,
                '0',
            );
            await bobReceivedMessage;

            // Bob replies to Alice
            await bob!.sendTextMessage(
                aliceDID,
                bobToAliceMessage,
                aliceSentMessage.sha256,
            );
            await aliceReceivedMessage;

            // Verify that messages were received correctly
            expect(onBobMessageReceived).toHaveBeenCalledWith(
                expect.objectContaining({ data: aliceToBobMessage }),
                expect.anything(),
            );
            expect(onAliceMessageReceived).toHaveBeenCalledWith(
                expect.objectContaining({ data: bobToAliceMessage }),
                expect.anything(),
            );

            // Verify that Charlie didn't receive any messages
            expect(onCharlieMessageReceived).not.toHaveBeenCalled();
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
            // two messages + protocol overhead
            const bobReceivedAllMessages = waitFor(
                bob!,
                'message',
                2 + protocolOverheadSize,
            );
            const bobReceivedFirstMessage = waitFor(bob!, 'message', 1);
            const firstMessage = await alice!.sendTextMessage(bobDID, '0', '0');
            await bobReceivedFirstMessage;
            await delay(50);
            await alice!.sendTextMessage(bobDID, '1', firstMessage.sha256);
            await bobReceivedAllMessages;
            expect(onBobMessageReceived).toHaveBeenCalledTimes(
                2 + protocolOverheadSize,
            );
            for (let index = 0; index < 2; index++) {
                expect(onBobMessageReceived).toHaveBeenCalledWith(
                    expect.objectContaining({
                        data: `${index}`,
                    } as EncapsulatedSmashMessage),
                    expect.anything(),
                );
            }
        });
    });

    describe('Alice sends multiple messages and they get delayed', () => {
        it('Bob receives them unordered and reorders them', async () => {
            const originalOrder = ['1', '2', '3', '4', '5'];
            const messageCount = originalOrder.length;
            const expectedReceivedOrder = ['1', '5', '4', '3', '2'];
            const waitForMessages = waitFor(
                bob!,
                'message',
                messageCount + protocolOverheadSize,
            );
            const delayAmount = 100;
            let messageDelay = messageCount * delayAmount;
            const decreaseDelay = () => (messageDelay -= delayAmount);
            const getDecreasingDelay = () => delay(decreaseDelay());
            const oldHandleData = handleServerData;
            handleServerData = async (...args) => {
                await getDecreasingDelay();
                await oldHandleData(...args);
            };
            let prevSha256: string = '0';
            for (let i = 0; i < messageCount; i++) {
                prevSha256 = (
                    await alice!.sendTextMessage(
                        bobDID,
                        originalOrder[i],
                        prevSha256,
                    )
                ).sha256;
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
        });
    });
});
