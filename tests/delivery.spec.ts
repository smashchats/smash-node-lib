import {
    EncapsulatedIMProtoMessage,
    Logger,
    SmashMessaging,
} from 'smash-node-lib';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { socketServerUrl } from './jest.global.cjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { TEST_CONFIG, aliasWaitFor, delay } from './time.utils';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { TestPeer, createPeer } from './user.utils';

/**
 * **************************************************************
 *  Testing message delivery and acknowledgment
 * **************************************************************
 */

// TODO: async closure ???
describe('[Message Delivery] Message delivery and acknowledgment', () => {
    const logger = new Logger('delivery.spec');
    const waitForEventCancelFns: (() => void)[] = [];
    const waitFor = aliasWaitFor(waitForEventCancelFns, logger);

    beforeAll(async () => {
        SmashMessaging.setCrypto(crypto);
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    });

    afterEach(async () => {
        waitForEventCancelFns.forEach((cancel) => cancel());
        waitForEventCancelFns.length = 0;
        jest.resetAllMocks();
    });

    describe('Alice', () => {
        let alice: TestPeer;
        let bob: TestPeer;
        const sendMsgToBob = () =>
            alice.messaging.sendTextMessage(
                bob.did,
                'test message',
                '',
            ) as Promise<EncapsulatedIMProtoMessage>;

        beforeEach(async () => {
            alice = await createPeer('alice', socketServerUrl);
        });

        afterEach(async () => {
            alice?.messaging.removeAllListeners();
            await alice?.messaging.close();
        });

        describe('sends a message to Bob on a valid SME', () => {
            beforeEach(async () => {
                bob = await createPeer('bob', socketServerUrl);
            });
            afterEach(async () => {
                bob?.messaging.removeAllListeners();
                await bob?.messaging.close();
            });

            it('should receive a DELIVERED ack on SME delivery', async () => {
                const waitForStatus = waitFor(alice.messaging, 'status');
                const sent = await sendMsgToBob();
                await waitForStatus;
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                expect(alice.onStatus).toHaveBeenCalledWith(
                    'delivered',
                    expect.arrayContaining([sent.sha256]),
                );
            });

            describe('then when Bob receives it', () => {
                it('should get a RECEIVED ack from Bob', async () => {
                    const waitForBobToReceive = waitFor(bob.messaging, 'data');
                    const sent = await sendMsgToBob();
                    await waitForBobToReceive;
                    await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                    expect(alice.onStatus).toHaveBeenCalledWith(
                        'received',
                        expect.arrayContaining([sent.sha256]),
                    );
                });
            });

            describe('but Bob is offline and doesnt receive it', () => {
                it('should NOT receive a RECEIVED ack', async () => {
                    bob?.messaging.removeAllListeners();
                    await bob?.messaging.close();
                    await sendMsgToBob();
                    await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                    expect(alice.onStatus).not.toHaveBeenCalledWith(
                        'received',
                        expect.anything(),
                    );
                });
            });

            it('message ACKs should not loop', async () => {
                const waitForBobToReceive = waitFor(bob.messaging, 'data');
                await sendMsgToBob();
                await waitForBobToReceive;
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                // statuses can be grouped, so at most called number of times is the
                // number of messages (+ include protocol overhead)
                expect(alice.onStatus.mock.calls.length).toBeLessThanOrEqual(
                    2 * (1 + TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE),
                );
            });
        });

        describe('sends a message to Bob on a not valid SME', () => {
            beforeEach(async () => {
                bob = await createPeer('bob', 'http://1.2.3.4:1234');
            });
            afterEach(async () => {
                bob?.messaging.removeAllListeners();
                await bob?.messaging.close();
            });

            it('should NOT receive a DELIVERED ack', async () => {
                const waitForStatus = waitFor(alice.messaging, 'status');
                await sendMsgToBob();
                await expect(waitForStatus).rejects.toThrow();
                expect(alice.onStatus).not.toHaveBeenCalled();
            });
        });
    });
});
