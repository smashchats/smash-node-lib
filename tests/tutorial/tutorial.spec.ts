import { Crypto } from '@peculiar/webcrypto';
import { SME_PUBLIC_KEY, socketServerUrl } from '@tests/jest.global.js';
import { TEST_CONFIG, aliasWaitFor, delay } from '@tests/utils/time.utils.js';
import {
    CryptoUtils,
    DID,
    DIDDocManager,
    DIDDocument,
    DIDString,
    IMPeerIdentity,
    IMProfile,
    IMProfileMessage,
    IMProtoMessage,
    IMText,
    IM_CHAT_TEXT,
    IM_PROFILE,
    Logger,
    NBH_ADDED,
    NBH_PROFILE_LIST,
    Relationship,
    SMASH_NBH_JOIN,
    SMASH_NBH_RELATIONSHIP,
    SmashEndpoint,
    SmashMessaging,
    SmashNAB,
    SmashProfile,
    SmashProfileList,
    SmashUser,
} from 'smash-node-lib';

/**
 * **************************************************************
 *  THE TUTORIAL (Diataxis)
 * **************************************************************
 */

// TODO docs
// - Reference -> unit tests (storybook type) + TSdoc blocks
// - How Tos -> specific (.spec.ts) test suites (covering edge cases and specific scenarios)
// - Tutorial > main test suite (tutorial.spec.ts) covering the happy path to fully explore the product
// - Explanations -> separately-maintained dev notes covering the why and how (dev.smashchats.com)
// TODO coverage rules
// - Reference -> 100% functions coverage (public APIs)
// - How Tos + Tutorial -> 100% lines coverage
// TODO cross link between docs and tests
// - Generate docs from tests
// - Showcase tests results in docs
// - Link relevant source code in docs

/**
 * @tutorial-meta
 * title: The Smash Tutorial
 * framework: Diataxis
 * type: Tutorial
 * description: Complete guide to using the Smash library, covering the core happy path
 * from identity creation to neighborhood participation.
 *
 * @implementation-notes
 * - This test suite serves as the source of truth for the main tutorial
 * - Each major section corresponds to a key concept in the library
 * - Test structure follows user journey from basic to advanced features
 */

describe('Smash Tutorial', () => {
    // Test infrastructure that won't appear in tutorial
    const testUtils = {
        logger: new Logger('tutorial', 'INFO'),
        waitForEventCancelFns: [] as (() => void)[],
        setupWaitFor() {
            return aliasWaitFor(this.waitForEventCancelFns, this.logger);
        },
        async cleanup() {
            await Promise.all(
                this.waitForEventCancelFns.map((cancel) => cancel()),
            );
            this.waitForEventCancelFns.length = 0;
            jest.resetAllMocks();
            await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
        },
    };

    const waitFor = testUtils.setupWaitFor();
    let didDocumentManager: DIDDocManager;

    beforeEach(async () => {
        didDocumentManager = new DIDDocManager();
        SmashMessaging.use('doc', didDocumentManager);
        testUtils.logger.info('DIDDocManager initialized');
    });

    /**
     * @tutorial-section Prerequisites
     * @tutorial-step 0
     * @concepts
     * - Cryptographic engine
     * - WebCrypto API
     *
     * @context
     * Before using Smash, we need to set up the cryptographic engine that will
     * handle all secure operations. Smash is compatible with any WebCrypto-compliant
     * implementation.
     */
    beforeAll(() => {
        const crypto = new Crypto();
        SmashMessaging.setCrypto(crypto);
        testUtils.logger.info('Crypto engine set. Ready!');
    });

    /**
     * @tutorial-section Identity Creation
     * @tutorial-step 1
     * @concepts
     * - Decentralized Identities (DIDs)
     * - W3C DID standard
     * - Identity Keys (IK)
     * - Exchange Keys (EK)
     * - Pre-Keys
     *
     * @context
     * The foundation of Smash is the DID (Decentralized Identifier). Each peer
     * needs their own DID, which contains the cryptographic keys needed for
     * secure messaging using the Signal protocol.
     */
    describe('1. Creating a new decentralized identity (DID)', () => {
        let bobIdentity: IMPeerIdentity;
        let bobExportedIdentity: string;

        beforeEach(async () => {
            bobIdentity = await didDocumentManager.generate();
            bobExportedIdentity = await bobIdentity.serialize();
        });

        /**
         * @tutorial-step 1.1
         * @task Examine the components of a DID document
         * @code-focus
         * - DID structure
         * - Identity and Exchange keys
         * - Key signatures
         */
        test('Understanding DID components', async () => {
            const bobDIDDocument = await bobIdentity.getDIDDocument();

            expect(bobDIDDocument.id).toBeDefined();
            testUtils.logger.info(`DID: ${bobDIDDocument.id}`);

            expect(bobDIDDocument.ik).toBeDefined();
            testUtils.logger.info(`IK: ${bobDIDDocument.ik}`);

            expect(bobDIDDocument.ek).toBeDefined();
            testUtils.logger.info(`EK: ${bobDIDDocument.ek}`);

            await expect(
                CryptoUtils.singleton.verifyExportedKey(
                    bobDIDDocument.ik,
                    bobDIDDocument.ek,
                    bobDIDDocument.signature,
                ),
            ).resolves.toBe(true);
        });

        /**
         * @tutorial-step 1.2
         * @task Learn about identity persistence
         * @concepts
         * - Identity serialization
         * - Identity restoration
         * - DID resolution
         */
        describe('Working with stored identities', () => {
            beforeEach(async () => {
                // Set up DID resolution for testing
                didDocumentManager.set(await bobIdentity.getDIDDocument());
            });

            /**
             * @tutorial-step 1.2.1
             * @task Create a Smash instance from stored identity
             * @code-focus
             * - Identity deserialization
             * - SmashUser instantiation
             */
            test('Restoring a Smash instance from saved identity', async () => {
                testUtils.logger.info('Deserializing identity...');
                const restoredIdentity =
                    await IMPeerIdentity.deserialize(bobExportedIdentity);
                testUtils.logger.info(`> Deserialized ${restoredIdentity.did}`);

                const bob = new SmashUser(restoredIdentity, 'bob', 'INFO');
                expect(bob).toBeInstanceOf(SmashMessaging);
                testUtils.logger.info(
                    'Messaging instance created successfully',
                );
            });
        });
    });

    /**
     * @tutorial-section Messaging Setup
     * @tutorial-step 2
     * @concepts
     * - SmashMessaging configuration
     * - Endpoints and mailboxes
     * - Message routing
     *
     * @context
     * After creating an identity, we need to configure the messaging system.
     * This includes setting up endpoints that act as mailboxes for receiving
     * messages when peers are offline.
     */
    describe('2. Setting up the SmashMessaging library', () => {
        const testContext = {
            async createMessagingInstance(): Promise<
                [SmashMessaging, IMPeerIdentity]
            > {
                const bobIdentity = await didDocumentManager.generate();
                return [new SmashUser(bobIdentity, 'bob', 'INFO'), bobIdentity];
            },
        };

        let bob: SmashMessaging;
        let bobIdentity: IMPeerIdentity;

        beforeEach(async () => {
            [bob, bobIdentity] = await testContext.createMessagingInstance();
        });

        afterEach(async () => {
            await bob.close();
        });

        /**
         * @tutorial-step 2.1
         * @task Configure messaging endpoints
         * @concepts
         * - Endpoint roles
         * - Pre-key generation
         * - DID document updates
         */
        test('Configuring messaging endpoints', async () => {
            testUtils.logger.info(
                `Setting up endpoints for ${bobIdentity.did}...`,
            );

            const preKeyPair = await bobIdentity.generateNewPreKeyPair();
            const addedEndpoint = await bob.endpoints.connect(
                {
                    url: socketServerUrl,
                    smePublicKey: SME_PUBLIC_KEY,
                },
                preKeyPair,
            );

            const updatedDIDDocument = await bob.getDIDDocument();
            expect(updatedDIDDocument.endpoints).toEqual(
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

    /**
     * @tutorial-section Peer Communication
     * @tutorial-step 3
     * @concepts
     * - Message types
     * - Peer-to-peer messaging
     * - Message delivery status
     * - Read receipts
     *
     * @context
     * With identity and messaging configured, peers can exchange messages.
     * Smash provides built-in support for delivery confirmation and read receipts.
     */
    describe('3. Exchanging messages with peers', () => {
        const testContext = {
            async initializePeer(name: string) {
                const identity = await didDocumentManager.generate();
                const messaging = new SmashUser(identity, name);
                await messaging.updateMeta({ title: name });

                const preKeyPair = await identity.generateNewPreKeyPair();
                await messaging.endpoints.connect(
                    {
                        url: socketServerUrl,
                        smePublicKey: SME_PUBLIC_KEY,
                    },
                    preKeyPair,
                );

                didDocumentManager.set(await messaging.getDIDDocument());
                return messaging;
            },
        };

        let bob: SmashMessaging;
        let alice: SmashMessaging;

        beforeEach(async () => {
            [bob, alice] = await Promise.all([
                testContext.initializePeer('bob'),
                testContext.initializePeer('alice'),
            ]);
        });

        afterEach(async () => {
            await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
            await Promise.allSettled([bob.close(), alice.close()]);
        });

        /**
         * @tutorial-step 3.1
         * @task Send your first message
         * @code-focus
         * - Message creation
         * - Message sending
         */
        test('Sending messages', async () => {
            const message = new IMText('Hello, Alice!');
            const sent = await bob.send(alice.did, message);

            expect(sent.type).toBe(IM_CHAT_TEXT);
            expect(sent.data).toBe('Hello, Alice!');
        });

        /**
         * @tutorial-step 3.2
         * @task Handle incoming messages
         * @code-focus
         * - Event listeners
         * - Message handling
         */
        test('Receiving messages', async () => {
            const onBobMessage = jest.fn();
            bob.on(IM_CHAT_TEXT, onBobMessage);

            const bobReceivedMessage = waitFor(bob, IM_CHAT_TEXT);
            const sent = await alice.send(bob.did, new IMText('Hello, Bob!'));
            await bobReceivedMessage;

            expect(onBobMessage).toHaveBeenCalledWith(
                alice.did,
                expect.objectContaining<IMProtoMessage>({
                    type: IM_CHAT_TEXT,
                    data: sent.data,
                    sha256: sent.sha256,
                    timestamp: sent.timestamp,
                    after: expect.any(String),
                }),
            );
        });

        /**
         * @tutorial-step 3.3
         * @task Track message status
         * @concepts
         * - Message delivery states
         * - Status notifications
         * - Read receipts
         */
        describe('Message status tracking', () => {
            const testContext = {
                async exchangeMessage(
                    from: SmashMessaging,
                    to: SmashMessaging,
                ) {
                    const received = waitFor(to, IM_CHAT_TEXT);
                    const sent = await from.send(
                        to.did,
                        new IMText('hello world'),
                    );
                    await received;
                    return sent;
                },
            };

            /**
             * @tutorial-step 3.3.1
             * @task Monitor message delivery
             */
            test('Message delivery confirmation', async () => {
                const onStatus = jest.fn();
                bob.on('status', onStatus);
                const sent = await testContext.exchangeMessage(bob, alice);
                expect(onStatus).toHaveBeenCalledWith('delivered', [
                    sent.sha256,
                ]);
            });

            /**
             * @tutorial-step 3.3.2
             * @task Track message reception
             */
            test('Message reception confirmation', async () => {
                const onStatus = jest.fn();
                bob.on('status', onStatus);
                const sent = await testContext.exchangeMessage(bob, alice);
                await delay(TEST_CONFIG.MESSAGE_DELIVERY * 2);
                expect(onStatus).toHaveBeenCalledWith('received', [
                    sent.sha256,
                ]);
            });

            /**
             * @tutorial-step 3.3.3
             * @task Implement read receipts
             */
            test('Message read status', async () => {
                const bobAck = jest.fn();
                bob.on('status', bobAck);
                const sent = await testContext.exchangeMessage(bob, alice);

                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                expect(bobAck).not.toHaveBeenCalledWith('read', [sent.sha256]);

                await alice.ackMessagesRead(bob.did, [sent.sha256]);
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                expect(bobAck).toHaveBeenCalledWith('read', [sent.sha256]);
            });
        });

        /**
         * @tutorial-step 3.4
         * @task Monitor all message events
         * @concepts
         * - Firehose events
         * - System messages
         * - Protocol overhead
         */
        test('Using the firehose', async () => {
            const onData = jest.fn();
            bob.on('data', onData);

            await alice.send(bob.did, new IMText('Hello, Bob!'));
            await delay(TEST_CONFIG.MESSAGE_DELIVERY * 3);

            const expectedMinCalls = TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE + 1 + 1;
            const expectedMaxCalls = TEST_CONFIG.PROTOCOL_OVERHEAD_SIZE * 2 + 1;
            expect(onData.mock.calls.length).toBeGreaterThanOrEqual(
                expectedMinCalls,
            );
            expect(onData.mock.calls.length).toBeLessThanOrEqual(
                expectedMaxCalls,
            );
        });
    });

    /**
     * @tutorial-section Profile Management
     * @tutorial-step 4
     * @concepts
     * - Peer profiles
     * - Profile updates
     * - Automatic profile sharing
     *
     * @context
     * Smash includes built-in profile management. Profiles are automatically
     * shared when peers first interact and when profile updates occur.
     */
    describe('4. Managing peer profiles', () => {
        const testContext = {
            async initializePeer(name: string) {
                const identity = await didDocumentManager.generate();
                const messaging = new SmashUser(identity, name);
                await messaging.updateMeta({ title: name });

                const preKeyPair = await identity.generateNewPreKeyPair();
                await messaging.endpoints.connect(
                    {
                        url: socketServerUrl,
                        smePublicKey: SME_PUBLIC_KEY,
                    },
                    preKeyPair,
                );

                didDocumentManager.set(await messaging.getDIDDocument());
                return messaging;
            },
        };

        let bob: SmashMessaging;
        let alice: SmashMessaging;

        beforeEach(async () => {
            [bob, alice] = await Promise.all([
                testContext.initializePeer('bob'),
                testContext.initializePeer('alice'),
            ]);
        });

        afterEach(async () => {
            await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
            await Promise.allSettled([bob.close(), alice.close()]);
        });

        /**
         * @tutorial-step 4.1
         * @task Understand automatic profile sharing
         * @concepts
         * - Initial contact
         * - Profile exchange
         */
        test('Initial profile exchange', async () => {
            const onProfile = jest.fn();
            bob.on(IM_PROFILE, onProfile);

            await bob.send(alice.did, new IMText('hello'));
            await delay(TEST_CONFIG.MESSAGE_DELIVERY * 2);

            expect(onProfile).toHaveBeenCalledWith(
                alice.did,
                expect.objectContaining<IMProfileMessage>({
                    type: IM_PROFILE,
                    data: {
                        did: alice.did,
                        title: 'alice',
                        description: '',
                        avatar: '',
                    },
                    after: expect.any(String),
                    sha256: expect.any(String),
                    timestamp: expect.any(String),
                }),
            );
        });

        /**
         * @tutorial-step 4.2
         * @task Handle profile updates
         * @concepts
         * - Profile modification
         * - Update propagation
         */
        test('Profile update propagation', async () => {
            const onProfile = jest.fn();
            bob.on(IM_PROFILE, onProfile);

            // Establish initial contact
            await bob.send(alice.did, new IMText('hello'));
            await delay(TEST_CONFIG.MESSAGE_DELIVERY);

            // Update profile
            await alice.updateMeta({ title: 'alice2' });
            await delay(TEST_CONFIG.MESSAGE_DELIVERY);

            expect(onProfile).toHaveBeenCalledWith(
                alice.did,
                expect.objectContaining<IMProfileMessage>({
                    type: IM_PROFILE,
                    data: {
                        did: alice.did,
                        title: 'alice2',
                        description: '',
                        avatar: '',
                    },
                    after: expect.any(String),
                    sha256: expect.any(String),
                    timestamp: expect.any(String),
                }),
            );
        });
    });

    /**
     * @tutorial-section Neighborhoods
     * @tutorial-step 5
     * @concepts
     * - Neighborhood concept
     * - Neighborhood Admin Bots (NAB)
     * - Peer discovery
     *
     * @context
     * Neighborhoods are Smash's way of organizing peer communities. Each neighborhood
     * is managed by a special peer called the Neighborhood Admin Bot (NAB) that
     * handles peer discovery and neighborhood membership.
     */
    describe('5. Working with Neighborhoods', () => {
        let nab: TestNAB;
        let bob: SmashUser;

        const testContext = {
            smeConfig: {
                url: socketServerUrl,
                smePublicKey: SME_PUBLIC_KEY,
            },
        };

        /**
         * @tutorial-step 5.1
         * @task Setting up a neighborhood (as a Neigbhorhood administrator)
         * A Neighborhood is an abstract concept of peers that are part of the same community.
         * Neighborhoods are managed by self-organizing peers called the Neighborhood Admin Bot (NAB).
         * NABs are regular Smash Messaging peers that have been configured to act as a NAB.
         * The library provides the abstract SmashNAB class to help you implement your own NAB.
         * @concepts
         * - Neighborhood joining process
         * - Join events
         * - NAB responses
         */
        class TestNAB extends SmashNAB {
            private members: DIDString[] = [];
            private metadata: Map<DIDString, IMProfile> = new Map();

            /**
             * @tutorial-step 5.1.1
             * @task Processing join requests
             * @concepts
             * - Neighborhood joining process
             * - Join events
             * - NAB responses
             */
            public onJoin = jest.fn(async (did: DID) => {
                const didDoc = await SmashMessaging.resolve(did);
                this.members.push(didDoc.id);
            });

            /**
             * @tutorial-step 5.1.2
             * @task Handling members profile data
             * @concepts
             * - Profile data storage
             * - Profile data retrieval
             */
            constructor(identity: IMPeerIdentity, name: string) {
                super(identity, name);
                this.on(IM_PROFILE, (did, profile) => {
                    this.metadata.set(did, profile.data);
                });
            }

            /**
             * @tutorial-step 5.1.3
             * @task Building a social graph
             * @concepts
             * - Smash
             * - Pass
             * - Social graph
             */
            public onRelationship = jest.fn(
                async (
                    from: DIDString,
                    to: DIDString,
                    relationship: Relationship,
                ) => {
                    if (!this.relationships.has(from)) {
                        this.relationships.set(from, new Map());
                    }
                    if (relationship === 'clear') {
                        this.relationships.get(from)?.delete(to);
                    } else {
                        this.relationships.get(from)?.set(to, relationship);
                    }
                },
            );
            // trivial users graph data model
            private relationships: Map<
                DIDString,
                Map<DIDString, Relationship>
            > = new Map();

            private readonly DEFAULT_DISTANCE = 10;

            // Calculate distance based on direct and indirect relationships
            private getDistance(from: DIDString, to: DIDString): number {
                // Direct relationship check
                const directRel = this.relationships.get(from)?.get(to);
                if (directRel) {
                    return directRel === 'smash' ? 0 : Infinity;
                }

                // Initialize distance as default
                let totalDistance = this.DEFAULT_DISTANCE;
                let pathCount = 0;

                // Check for indirect relationships through intermediaries
                const visited = new Set<DIDString>();
                const queue: Array<[DIDString, number]> = [[from, 0]];

                while (queue.length > 0) {
                    const [current, depth] = queue.shift()!;

                    const relationships = this.relationships.get(current);
                    if (!relationships) continue;

                    for (const [nextPeer, rel] of relationships.entries()) {
                        if (rel !== 'smash') continue;

                        if (nextPeer === to) {
                            // Each path contributes to decreasing the total distance
                            const pathContribution =
                                this.DEFAULT_DISTANCE / (depth + 2);
                            totalDistance =
                                (totalDistance * pathCount + pathContribution) /
                                (pathCount + 1);
                            pathCount++;
                        } else if (!visited.has(nextPeer)) {
                            visited.add(nextPeer);
                            queue.push([nextPeer, depth + 1]);
                        }
                    }
                }

                return totalDistance;
            }

            /**
             * @tutorial-step 5.1.4
             * @task Processing discover requests
             * @concepts
             * - Peer discovery
             * - Profile broadcasting
             * - NAB-mediated discovery
             */
            public onDiscover = jest.fn(async (from: DIDString) => {
                const otherMembers = this.members.filter(
                    (member) => member !== from,
                );
                return (await Promise.all(
                    otherMembers.map(async (member) => ({
                        did: await SmashMessaging.resolve(member),
                        meta: this.metadata.get(member),
                        scores: {
                            distance: this.getDistance(from, member),
                        },
                    })),
                )) as SmashProfileList;
            });
        }

        beforeEach(async () => {
            // Set up NAB with new identity
            const nabIdentity = await didDocumentManager.generate();
            nab = new TestNAB(nabIdentity, 'test-nab');

            // Connect NAB to endpoint
            const preKeyPair = await nabIdentity.generateNewPreKeyPair();
            await nab.endpoints.connect(testContext.smeConfig, preKeyPair);

            // Register NAB's DID document
            didDocumentManager.set(await nab.getDIDDocument());
        });

        afterEach(async () => {
            await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
            await Promise.all([nab?.close(), bob?.close()]);
        });

        /**
         * @tutorial-step 5.2
         * @task Joining a neighborhood (as a Neighborhood user)
         * @concepts
         * - Neighborhood joining process
         * - Join events
         * - NAB responses
         */
        test(
            'Joining a neighborhood',
            async () => {
                // Set up test user
                const bobIdentity = await didDocumentManager.generate();
                bob = new SmashUser(bobIdentity, 'bob');

                // Calculate timeout
                const JOIN_TIMEOUT =
                    TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT -
                    TEST_CONFIG.MESSAGE_DELIVERY;

                // Set up join event listener
                const waitForJoin = waitFor(nab, SMASH_NBH_JOIN, {
                    timeout: JOIN_TIMEOUT,
                });
                const onNbhAdded = jest.fn();
                bob.on(NBH_ADDED, onNbhAdded);

                // Join neighborhood and wait for confirmation
                const joinInfo = await nab.getJoinInfo([testContext.smeConfig]);
                await bob.join(joinInfo);

                await waitForJoin;

                // Verify that the specified NAB received the join request
                const bobDIDDocument = await bob.getDIDDocument();
                expect(nab.onJoin).toHaveBeenCalledWith(
                    bobDIDDocument,
                    expect.any(String),
                    expect.any(String),
                );

                // Verify join callback (on User side)
                expect(onNbhAdded).toHaveBeenCalledWith(nab.did);
            },
            TEST_CONFIG.MESSAGE_DELIVERY_TIMEOUT,
        );

        describe('In a Neighborhood with other peers', () => {
            let alice: SmashUser;
            let darcy: SmashUser;

            beforeEach(async () => {
                const bobIdentity = await didDocumentManager.generate();
                const aliceIdentity = await didDocumentManager.generate();
                const darcyIdentity = await didDocumentManager.generate();
                await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);

                bob = new SmashUser(bobIdentity, 'bob');
                alice = new SmashUser(aliceIdentity, 'alice');
                darcy = new SmashUser(darcyIdentity, 'darcy');

                const allThreeHaveJoined = waitFor(nab, SMASH_NBH_JOIN, {
                    count: 3,
                    timeout: 2 * TEST_CONFIG.TEST_TIMEOUT_MS,
                });
                const joinInfo = await nab.getJoinInfo([testContext.smeConfig]);
                await Promise.all([
                    bob.join(joinInfo),
                    alice.join(joinInfo),
                    darcy.join(joinInfo),
                ]);

                await allThreeHaveJoined;
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);

                const profilesUpdated = waitFor(nab, IM_PROFILE, {
                    count: 3,
                    timeout: 2 * TEST_CONFIG.TEST_TIMEOUT_MS,
                });
                await bob.updateMeta({ title: 'bob' });
                await alice.updateMeta({ title: 'alice' });
                await darcy.updateMeta({ title: 'darcy' });

                await profilesUpdated;
                await delay(TEST_CONFIG.MESSAGE_DELIVERY);

                await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
            }, TEST_CONFIG.TEST_TIMEOUT_MS * 5);

            afterEach(async () => {
                await Promise.all([
                    alice?.close(),
                    darcy?.close(),
                    bob?.close(),
                ]);
            });

            /**
             * @tutorial-step 5.3
             * @task Discover neighborhood peers
             * @concepts
             * - Peer discovery mechanism
             * - Profile broadcasting
             * - NAB-mediated discovery
             */
            test('Discovering neighborhood peers', async () => {
                const onNeighborhoodProfiles = jest.fn();
                bob.on(NBH_PROFILE_LIST, onNeighborhoodProfiles);
                const waitForDiscovery = waitFor(bob, NBH_PROFILE_LIST);

                await bob.discover();
                await waitForDiscovery;

                // Verify Bob's profile discovery result contains Alice and Darcy's profiles
                const expectedDiscoveredProfile = async (user: SmashUser) => {
                    const didDoc = await user.getDIDDocument();
                    return expect.objectContaining<SmashProfile>({
                        did: expect.objectContaining<DIDDocument>({
                            id: didDoc.id,
                            ik: didDoc.ik,
                            ek: didDoc.ek,
                            signature: expect.any(String),
                            endpoints: expect.arrayContaining([
                                expect.objectContaining<SmashEndpoint>({
                                    url: testContext.smeConfig.url,
                                    preKey: expect.any(String),
                                    signature: expect.any(String),
                                }),
                            ]),
                        }),
                        meta: user.profile,
                    });
                };
                expect(onNeighborhoodProfiles).toHaveBeenCalledWith(
                    nab.did,
                    expect.arrayContaining(
                        await Promise.all([
                            expectedDiscoveredProfile(alice),
                            expectedDiscoveredProfile(darcy),
                        ]),
                    ) as SmashProfileList,
                );
            });

            /**
             * @tutorial-step 5.4
             * @task Building a social graph by setting interaction preferences
             * @concepts
             * - Smash
             * - Pass
             * - Social graph
             */
            describe('Building a social graph', () => {
                const getDistanceFromBobToAlice = () =>
                    new Promise<number>((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            reject(new Error('Timeout'));
                        }, TEST_CONFIG.TEST_TIMEOUT_MS);
                        bob.once(NBH_PROFILE_LIST, (_, profiles) => {
                            const aliceProfile = profiles.find(
                                (profile) => profile.did.id === alice.did,
                            );
                            clearTimeout(timeout);
                            resolve(aliceProfile?.scores?.distance ?? Infinity);
                        });
                        bob.discover();
                    });
                let initialDistance: number;
                let nabReceivedRelationship: Promise<void>;

                beforeEach(async () => {
                    initialDistance = await getDistanceFromBobToAlice();
                    nabReceivedRelationship = waitFor(
                        nab,
                        SMASH_NBH_RELATIONSHIP,
                    );
                });

                /**
                 * @tutorial-step 5.4.1
                 * @task Smashing another peer
                 * @concepts
                 * - Smash
                 * - Social graph
                 */
                test(
                    'Bob smashing Alice',
                    async () => {
                        await bob.smash(alice.did);
                        await nabReceivedRelationship;
                        expect(nab.onRelationship).toHaveBeenCalledWith(
                            bob.did,
                            alice.did,
                            'smash',
                            expect.any(String),
                            expect.any(String),
                        );
                        const newDistance = await getDistanceFromBobToAlice();
                        expect(newDistance).toBeLessThan(initialDistance);
                    },
                    TEST_CONFIG.TEST_TIMEOUT_MS * 2,
                );

                /**
                 * @tutorial-step 5.4.2
                 * @task Passing another peer
                 * @concepts
                 * - Pass
                 * - Social graph
                 */
                test(
                    'Bob passing Alice',
                    async () => {
                        await bob.pass(alice.did);
                        await nabReceivedRelationship;
                        expect(nab.onRelationship).toHaveBeenCalledWith(
                            bob.did,
                            alice.did,
                            'pass',
                            expect.any(String),
                            expect.any(String),
                        );
                        const newDistance = await getDistanceFromBobToAlice();
                        expect(newDistance).toBeGreaterThan(initialDistance);
                    },
                    TEST_CONFIG.TEST_TIMEOUT_MS * 2,
                );

                /**
                 * @tutorial-step 5.4.3
                 * @task Clearing any previous relationship
                 * @concepts
                 * - Social graph
                 */
                test(
                    'Bob clearing Alice',
                    async () => {
                        await bob.smash(alice.did);
                        await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                        await bob.clear(alice.did);
                        await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                        await bob.pass(alice.did);
                        await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                        await bob.clear(alice.did);
                        await delay(TEST_CONFIG.MESSAGE_DELIVERY);
                        await nabReceivedRelationship;
                        const newDistance = await getDistanceFromBobToAlice();
                        expect(newDistance).toEqual(initialDistance);
                    },
                    TEST_CONFIG.TEST_TIMEOUT_MS * 4,
                );
            });
        });
    });
});
