import { Crypto } from '@peculiar/webcrypto';
import { SME_PUBLIC_KEY, socketServerUrl } from '@tests/jest.global.js';
import {
    CryptoUtils,
    DIDDocManager,
    DIDDocument,
    IMPeerIdentity,
    IMText,
    IM_CHAT_TEXT,
    Logger,
    SmashEndpoint,
    SmashMessaging,
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
        [bobDIDDocument, bobIdentity] = await didDocumentManager.generate();
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
            bob = new SmashUser(
                bobIdentity,
                // the log ID (used to identify the source of the log) & level
                'bob',
                'INFO',
            );
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
            const newDidDocument = await bob.getDID();
            expect(newDidDocument.endpoints.length).toBe(
                bobDIDDocument.endpoints.length + 1,
            );
            expect(newDidDocument.endpoints).toContain(
                expect.objectContaining({
                    url: socketServerUrl,
                    preKey: addedEndpoint.preKey,
                    signature: addedEndpoint.signature,
                } as SmashEndpoint),
            );
        });
    });

    describe('3. Exchanging messages with a peer', () => {
        let bob: SmashMessaging;
        let alice: SmashMessaging;

        beforeEach(async () => {
            const initPeer = async (name: string) => {
                const identity = (await didDocumentManager.generate())[1];
                const messaging = new SmashUser(identity, name, 'INFO');
                // TODO: use reset (automatically, through provided identity & did doc) instead
                await messaging.endpoints.connect(
                    {
                        url: socketServerUrl,
                        smePublicKey: SME_PUBLIC_KEY,
                    },
                    bobIdentity.signedPreKeys[0],
                );
                return messaging;
            };
            [bob, alice] = await Promise.all([
                initPeer('bob'),
                initPeer('alice'),
            ]);
        });

        test('3.1. Sending a text message to a peer', async () => {
            const message = new IMText('Hello, Alice!');
            const sent = await bob.send(alice.did, message);
            expect(sent.sha256).toBeDefined();
            expect(sent.type).toBe(IM_CHAT_TEXT);
            expect(sent.data).toBe('Hello, Alice!');
            expect(sent.after).toBeUndefined();
        });
    });
});
