import { Crypto } from '@peculiar/webcrypto';
import { SME_PUBLIC_KEY, socketServerUrl } from '@tests/jest.global.js';
import { TEST_CONFIG, aliasWaitFor, delay } from '@tests/time.utils.js';
import {
    CryptoUtils,
    DIDDocManager,
    DIDDocument,
    IMPeerIdentity,
    IMProtoMessage,
    IMText,
    IM_CHAT_TEXT,
    Logger,
    SmashEndpoint,
    SmashMessaging,
    SmashPeer,
    SmashUser,
} from 'smash-node-lib';

/**
 * **************************************************************
 *  THE TUTORIAL (Diataxis)
 * **************************************************************
 */

// TODO converge all tests into a single tutorial with suite = main step
// 'THE' tutorial as per Diataxis framework should be the one and only
// tutorial for the product , and contains all a user needs to know
// in order to perform the 'happy path'. then, other docs will complement:
// - How To: solving specific complex/occasional use cases
// - Reference: under the hood / user manual
// - Explanations: the why and how of the library
// TODO we should find a way to keep in sync test suites and docs
// in particular:
// - Reference -> unit tests & code blocks + comments
// - How Tos -> specific test suites (covering edge cases)
// - Tutorial > main test suites
// - Explanations -> separately maintained dev notes

describe('Welcome to using the Smashchats library!', () => {
    const logger = new Logger('tutorial', 'INFO');
    const waitForEventCancelFns: (() => void)[] = [];
    const waitFor = aliasWaitFor(waitForEventCancelFns, logger);

    let didDocumentManager: DIDDocManager;

    beforeAll(() => {
        // Before anything, a crypto engine needs to be defined.
        // This is the crypto library that our library will use to
        // perform cryptographic operations.
        // Generate keys, sign data, encrypt and decrypt messages...
        // The library is compatible with the WebCrypto API, so you can use any
        // WebCrypto-compatible library, such as '@peculiar/webcrypto'.
        // or the native 'crypto' library available in Node.JS and browsers.
        const crypto = new Crypto();
        SmashMessaging.setCrypto(crypto);
        // The .setCrypto() method MUST be called before any crypto op is performed.
        logger.info('Crypto engine set. Ready!');
    });

    let bobDIDDocument: DIDDocument;
    let bobIdentity: IMPeerIdentity;

    beforeEach(async () => {
        // An identity can be summarized in the 'DID'—a W3C standard to allow
        // self-sovereign online/digital identities, that are reusable accross apps.
        // In Smash, DIDs contain cryptographic keys that enable secure private messaging
        // between peers in the network. IK, EK, Pre-Keys, and optionally One-Time Pre-Keys.
        // These cryptographic keys are required by the Signal protocol to perform secure
        // private messaging between peers.
        // the DID document is the publicly sharable crypto information
        didDocumentManager = new DIDDocManager();
        SmashMessaging.use('doc', didDocumentManager);
        [bobDIDDocument, bobIdentity] = await didDocumentManager.generate();
    });

    afterEach(async () => {
        logger.debug('>> canceling all waiters');
        await Promise.all(waitForEventCancelFns.map((cancel) => cancel()));
        waitForEventCancelFns.length = 0;
        logger.debug('>> resetting mocks');
        jest.resetAllMocks();
        await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
    });

    describe('1. Creating a new decentralized identity (DID)', () => {
        let bobExportedIdentity: string;

        beforeEach(async () => {
            // the Identity is the private crypto information (NEVER SHARE THIS!)
            bobExportedIdentity = await bobIdentity.serialize();
        });

        test('Checking Bobs generated decentralized identity', async () => {
            // the DID document is the publicly sharable crypto information
            expect(bobDIDDocument.id).toBeDefined();
            logger.info(`DID: ${bobDIDDocument.id}`);
            // IK is the long-lived identity key used to sign other keys
            expect(bobDIDDocument.ik).toBeDefined();
            logger.info(`IK: ${bobDIDDocument.ik}`);
            // EK is the medium-lived exchange key used to derive session keys
            expect(bobDIDDocument.ek).toBeDefined();
            logger.info(`EK: ${bobDIDDocument.ek}`);
            // EK is signed by IK
            expect(bobDIDDocument.signature).toBeDefined();
            // we can verify the EK was indeed signed by the provided IK
            await CryptoUtils.singleton.verifyExportedKey(
                bobDIDDocument.ik,
                bobDIDDocument.ek,
                bobDIDDocument.signature,
            );
            await expect(
                CryptoUtils.singleton.verifyExportedKey(
                    bobDIDDocument.ik,
                    bobDIDDocument.ek,
                    bobDIDDocument.signature,
                ),
            ).resolves.toBe(true);
            // no endpoints are defined at this point
            expect(bobDIDDocument.endpoints.length).toBe(0);
            // the Identity is the private crypto information (NEVER SHARE THIS!)
            expect(bobExportedIdentity).toBeDefined();
            logger.info(`Serialized identity (SECRET): ${bobExportedIdentity}`);
        });

        describe('1.1. Importing the exported identity', () => {
            beforeEach(() => {
                // for these tests we use a DID method that does not propagate
                // it relies on the user knowing the full DID document
                // in order to resolve a DID to its DID Document.
                if (bobDIDDocument) didDocumentManager.set(bobDIDDocument);
                // other methods such as 'web', 'key', 'plc', ... are more
                // appropriate for production uses.
            });

            let bob: SmashMessaging;

            test('Instantiating Smash User with the re-imported Identity', async () => {
                // now that we have a DID/Identity for Bob, we can instantiate the Smash User
                // library to start using the Smash protocol.
                // First, we need to re-import the exported (serialized) identity
                logger.info('Deserializing identity...');
                const bobIdentity =
                    await IMPeerIdentity.deserialize(bobExportedIdentity);
                logger.info(`> Deserialized ${bobIdentity.did}`);
                expect(bobIdentity).toBeInstanceOf(IMPeerIdentity);
                // now we can instantiate the Smash User library using Bob's identity
                bob = new SmashUser(
                    bobIdentity,
                    // the log ID (used to identify the source of the log) & level
                    'bob',
                    'INFO',
                );
                expect(bob).toBeInstanceOf(SmashMessaging);
                logger.info(`Bob's messaging instance created!`);
            });
        });
    });

    describe('2. Setting up the SmashMessaging library', () => {
        let bob: SmashMessaging;

        beforeEach(async () => {
            // Create a new SmashMessaging instance with Bob's generated identity
            bob = new SmashUser(
                bobIdentity,
                // the log ID (used to identify the source of the log) & level
                'bob',
                'INFO',
            );
        });

        afterEach(async () => {
            // Close the SmashMessaging instance
            await bob.close();
        });

        test('2.1. Configuring new IMProto Endpoints', async () => {
            // Endpoints play the role of 'Mailboxes' in the IM protocol.
            // They are used to asynchronously send and receive messages from other peers.
            // and as signaling servers in order to:
            // 1/ Establish Signal encryption sessions between offline peers,
            // 2/ Relay P2P sessions establishment information.
            logger.info(
                `Configuring IMProto Endpoints for ${bobDIDDocument.id}...`,
            );
            // connecting a new endpoint adds it to the (local) DID document
            // bob.endpoints.connect(endpoint, updateIdentity, updateDID)
            // updateIdentity: whether to update the local identity with the new endpoint
            // updateDID: whether to update the propagated DID document with the new endpoint
            const preKeyPair = await bobIdentity.generateNewPreKeyPair();
            const addedEndpoint = await bob.endpoints.connect(
                {
                    url: socketServerUrl,
                    smePublicKey: SME_PUBLIC_KEY,
                },
                preKeyPair,
            );
            const newDidDocument = await bob.getDIDDocument();
            expect(newDidDocument.endpoints.length).toBe(
                bobDIDDocument.endpoints.length + 1,
            );
            expect(newDidDocument.endpoints).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        url: socketServerUrl,
                        preKey: addedEndpoint.preKey,
                        signature: addedEndpoint.signature,
                    } as SmashEndpoint),
                ]),
            );
        });
    });

    describe('3. Exchanging messages with a peer', () => {
        let bob: SmashMessaging;
        let alice: SmashMessaging;

        beforeEach(async () => {
            const initPeer = async (name: string) => {
                const identity = (await didDocumentManager.generate())[1];
                const messaging = new SmashUser(identity, name, 'DEBUG');
                await messaging.updateMeta({ title: name });
                const preKeyPair = await identity.generateNewPreKeyPair();
                // TODO: use reset (automatically, through provided identity & did doc) instead
                await messaging.endpoints.connect(
                    {
                        url: socketServerUrl,
                        smePublicKey: SME_PUBLIC_KEY,
                    },
                    preKeyPair,
                );
                // We're simulating DID document propagation by setting the
                // DID document in the DIDDocManager.
                didDocumentManager.set(await messaging.getDIDDocument());
                return messaging;
            };
            [bob, alice] = await Promise.all([
                initPeer('bob'),
                initPeer('alice'),
            ]);
        });

        afterEach(async () => {
            await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
            await Promise.allSettled([bob.close(), alice.close()]);
        });

        test('3.1. Sending a text message to a peer', async () => {
            const message = new IMText('Hello, Alice!');
            const sent = await bob.send(alice.did, message);
            expect(sent.sha256).toBeDefined();
            expect(sent.type).toBe(IM_CHAT_TEXT);
            expect(sent.data).toBe('Hello, Alice!');
            expect(sent.after).toEqual('');
        });

        test('3.2. Receiving a text message from a peer', async () => {
            const onBobMessage = jest.fn();
            // NOTE: better to use the exported IM_CHAT_TEXT constant rather than hardcoded 'org.improto.chat.text'
            bob.on(IM_CHAT_TEXT, onBobMessage);

            const bobReceivedMessage = waitFor(bob, IM_CHAT_TEXT);
            const sent = await alice.send(bob.did, new IMText('Hello, Bob!'));
            await bobReceivedMessage;

            expect(onBobMessage).toHaveBeenCalledWith(
                alice.did,
                expect.objectContaining<IMProtoMessage>({
                    type: 'org.improto.chat.text',
                    data: sent.data,
                    sha256: sent.sha256,
                    timestamp: sent.timestamp,
                    after: '',
                }),
                expect.any(SmashPeer),
            );
            expect(onBobMessage).toHaveBeenCalledTimes(1);
        });

        describe('3.3 Status updates', () => {
            const sendMessage = async (
                from: SmashMessaging,
                to: SmashMessaging,
            ) => {
                const did = await to.getDIDDocument();
                const received = waitFor(to, IM_CHAT_TEXT);
                const sent = await from.send(did, new IMText('hello world'));
                await received;
                return sent;
            };

            test('3.3.1 Message delivered', async () => {
                const onStatus = jest.fn();
                bob.on('status', onStatus);
                const sent = await sendMessage(bob, alice);
                expect(onStatus).toHaveBeenCalledWith('delivered', [
                    sent.sha256,
                ]);
            });

            test('3.3.2 Message received', async () => {
                const onStatus = jest.fn();
                bob.on('status', onStatus);
                const sent = await sendMessage(bob, alice);
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                expect(onStatus).toHaveBeenCalledWith('received', [
                    sent.sha256,
                ]);
            });

            test('3.3.3 Message read', async () => {
                const bobAck = jest.fn();
                bob.on('status', bobAck);
                const sent = await sendMessage(bob, alice);
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                expect(bobAck).not.toHaveBeenCalledWith('read', [sent.sha256]);
                await alice.ackMessagesRead(bob.did, [sent.sha256]);
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                expect(bobAck).toHaveBeenCalledWith('read', [sent.sha256]);
            });
        });

        test('3.4. Firehose', async () => {
            // The SmashMessaging API provides a _firehose_ endpoint that
            // allows to listen to all messages sent to the peer (including system messages).
            const onData = jest.fn();
            bob.on('data', onData);

            await alice.send(bob.did, new IMText('Hello, Bob!'));
            await delay(TEST_CONFIG.MESSAGE_DELIVERY * 3);

            const expectedCalls = (1 + TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE) * 2;
            expect(onData).toHaveBeenCalledTimes(expectedCalls);
        });
    });
});
