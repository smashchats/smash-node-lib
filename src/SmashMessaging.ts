import { Curve, Identity, setEngine } from '2key-ratchet';
import { SmashPeer } from '@src/SmashPeer.js';
import { BaseResolver, DataForwardingResolver } from '@src/callbacks/index.js';
import { DIDResolver } from '@src/did/index.js';
import { SessionManager } from '@src/signal/index.js';
import { SMESocketManager } from '@src/sme/index.js';
import type {
    DID,
    DIDDocument,
    DIDString,
    EncapsulatedIMProtoMessage,
    IECKeyPair,
    IJsonIdentity,
    IMProfile,
    IMProfileMessage,
    IMProtoMessage,
    IMReceivedACKMessage,
    IMSessionEndpointMessage,
    IMSessionResetMessage,
    IMTextMessage,
    SMEConfigJSONWithoutDefaults,
    SmashEndpoint,
    sha256,
} from '@src/types/index.js';
import {
    IM_ACK_RECEIVED,
    IM_CHAT_TEXT,
    IM_PROFILE,
    IM_SESSION_ENDPOINT,
    IM_SESSION_RESET,
    SME_DEFAULT_CONFIG,
} from '@src/types/index.js';
import type { LogLevel } from '@src/utils/index.js';
import { CryptoUtils, Logger } from '@src/utils/index.js';
import { EventEmitter } from 'events';
import { setInterval } from 'timers';

interface IJWKJson extends CryptoKey {
    jwk?: JsonWebKey;
}

interface IJWKJsonKeyPair {
    privateKey: IJWKJson;
    publicKey: IJWKJson;
    thumbprint?: string;
}

interface SmashChat {
    with: DID;
    lastMessageTimestamp: string;
}

type ProfileMeta = Omit<IMProfile, 'did'>;

class PreferredEndpointHandler extends BaseResolver<
    IMSessionEndpointMessage,
    void
> {
    resolve(peer: SmashPeer, message: IMSessionEndpointMessage): Promise<void> {
        peer.setPreferredEndpoint(message.data);
        return Promise.resolve();
    }
}

class SessionResetHandler extends BaseResolver<IMSessionResetMessage, void> {
    resolve(peer: SmashPeer, message: IMSessionResetMessage): Promise<void> {
        return peer.incomingSessionReset(message.sha256!);
    }
}

// TODO: refactor
// TODO: safeguard crypto operations against errors
// TODO: split beteen IMProto and Smash Messaging
export class SmashMessaging extends EventEmitter {
    protected readonly logger: Logger;
    private static crypto: globalThis.Crypto;

    static setCrypto(c: globalThis.Crypto) {
        this.crypto = c;
        setEngine('@peculiar/webcrypto', c);
        CryptoUtils.setCryptoSubtle(c.subtle);
    }

    private static patchedGenerateKey: boolean = false;
    /**
     * Generates a cryptographic identity with the given number of prekeys and onetime keys.
     * @param nbPreKeys Number of prekeys to generate (used for endpoints).
     * @param nbOnetimeKeys Number of onetime keys to generate (used for new sessions).
     * @param extractable Whether the keys should be extractable (default to false).
     * @returns The generated identity.
     */
    static generateIdentity(
        nbPreKeys: number = 1,
        nbOnetimeKeys: number = 0,
        extractable: boolean = false,
    ) {
        if (!this.patchedGenerateKey) {
            // Patch crypto.subtle.generateKey if not already done
            const c = this.crypto;
            const originalGenerateKey = c.subtle.generateKey;
            c.subtle.generateKey = async function (
                this: SubtleCrypto,
                ...args: Parameters<typeof originalGenerateKey>
            ): ReturnType<typeof originalGenerateKey> {
                const keyPairOrSingleKey = await originalGenerateKey.apply(
                    this,
                    args,
                );
                const attachJwk = async (
                    key: CryptoKey & { _exportedJwk?: JsonWebKey },
                ) => {
                    if (!key.extractable) return;
                    key._exportedJwk = await c.subtle.exportKey('jwk', key);
                };
                if ('privateKey' in keyPairOrSingleKey) {
                    await attachJwk(keyPairOrSingleKey.privateKey);
                    await attachJwk(keyPairOrSingleKey.publicKey);
                } else {
                    await attachJwk(keyPairOrSingleKey);
                }
                return keyPairOrSingleKey;
            } as typeof c.subtle.generateKey;
            this.patchedGenerateKey = true;
        }
        return Identity.create(0, nbPreKeys, nbOnetimeKeys, extractable);
    }

    private static async reconstituteCryptoKey(
        key: IJWKJson,
    ): Promise<CryptoKey> {
        if (!key.jwk) return key as CryptoKey;
        return await this.crypto.subtle.importKey(
            'jwk',
            key.jwk,
            key.algorithm,
            true,
            key.usages,
        );
    }

    private static async reconstituteKeys(
        identityJSON: IJsonIdentity,
    ): Promise<IJsonIdentity> {
        const reconstituteKeyPair = async (
            keyPair: IJWKJsonKeyPair,
        ): Promise<IJWKJsonKeyPair> => {
            return {
                privateKey: await this.reconstituteCryptoKey(
                    keyPair.privateKey,
                ),
                publicKey: await this.reconstituteCryptoKey(keyPair.publicKey),
                thumbprint: keyPair.thumbprint,
            };
        };
        return {
            id: 0,
            signingKey: await reconstituteKeyPair(identityJSON.signingKey),
            exchangeKey: await reconstituteKeyPair(identityJSON.exchangeKey),
            preKeys: await Promise.all(
                identityJSON.preKeys.map(reconstituteKeyPair),
            ),
            signedPreKeys: await Promise.all(
                identityJSON.signedPreKeys.map(reconstituteKeyPair),
            ),
            createdAt: identityJSON.createdAt,
        };
    }

    static async deserializeIdentity(
        identityJSON: IJsonIdentity,
        ecKeyPairFromJson?: (keys: IJWKJsonKeyPair) => Promise<IECKeyPair>,
    ): Promise<Identity> {
        try {
            if (ecKeyPairFromJson) Curve.ecKeyPairFromJson = ecKeyPairFromJson;
            return Identity.fromJSON(await this.reconstituteKeys(identityJSON));
        } catch (err) {
            new Logger('SmashMessaging').error('Cannot parse identity json.');
            throw err;
        }
    }

    static async serializeIdentity(identity: Identity): Promise<IJsonIdentity> {
        const serializedIdentity = JSON.parse(
            JSON.stringify(await identity.toJSON(), (_, value) => {
                if (
                    value &&
                    typeof value === 'object' &&
                    '_exportedJwk' in value
                ) {
                    return {
                        jwk: value._exportedJwk,
                        algorithm: value.algorithm,
                        usages: value.usages,
                        extractable: value.extractable,
                        type: value.type,
                    };
                }
                return value;
            }),
        );

        return serializedIdentity;
    }

    exportIdentityToJSON(): Promise<IJsonIdentity> {
        return SmashMessaging.serializeIdentity(this.identity);
    }

    private readonly dlq: Record<string, EncapsulatedIMProtoMessage[]>;
    private readonly peers: Record<string, SmashPeer>;
    private endpoints: SmashEndpoint[];
    private readonly sessionManager: SessionManager;
    private readonly smeSocketManager: SMESocketManager;
    private readonly processedMessages: Map<sha256, number> = new Map();
    private static readonly cacheExpiryTime = 1000 * 60 * 60; // 1 hour
    private static readonly cacheCleanupInterval = 1000 * 60 * 15; // 15 minutes

    constructor(
        protected readonly identity: Identity,
        private meta?: ProfileMeta,
        LOG_LEVEL: LogLevel = 'INFO',
        LOG_ID: string = 'SmashMessaging',
    ) {
        super();
        this.logger = new Logger(LOG_ID, LOG_LEVEL);
        this.dlq = {};
        this.peers = {};
        this.endpoints = [];
        this.sessionManager = new SessionManager(identity, this.logger);
        this.smeSocketManager = new SMESocketManager(
            this.incomingMessagesHandler.bind(this),
            this.messagesStatusHandler.bind(this),
            this.logger,
        );
        this.superRegister(IM_PROFILE, new DataForwardingResolver(IM_PROFILE));
        this.superRegister(
            IM_SESSION_RESET,
            new SessionResetHandler(IM_SESSION_RESET),
        );
        this.superRegister(
            IM_SESSION_ENDPOINT,
            new PreferredEndpointHandler(IM_SESSION_ENDPOINT),
        );
        this.superRegister(
            IM_ACK_RECEIVED,
            new DataForwardingResolver(IM_ACK_RECEIVED),
        );
        this.on(IM_ACK_RECEIVED, (from: DIDString, messageIds: sha256[]) => {
            this.logger.debug(`>> Received ACK for ${messageIds} from ${from}`);
            this.emit('status', 'received', messageIds);
            this.peers[from]?.ack(messageIds).then(() => {
                this.logger.debug(
                    `> cleared ${messageIds} from sending queues`,
                );
            });
        });
        this.logger.info(`Loaded Smash lib (log level: ${LOG_LEVEL})`);

        // Start cleanup interval
        setInterval(
            () => this.cleanupProcessedMessages(),
            SmashMessaging.cacheCleanupInterval,
        );
    }

    async close() {
        const peersToClose = Object.values(this.peers).map((p) =>
            p.cancelRetry(),
        );
        this.logger.debug(`>> closing (${peersToClose.length}) peers`);
        const peersResult = await Promise.allSettled(peersToClose);
        this.logger.debug(`>> closing (${this.endpoints.length}) endpoints`);
        const socketsResult = await this.smeSocketManager.closeAllSockets();
        this.endpoints = [];
        const failedToClosePeers = peersResult.filter(
            (r) => r.status === 'rejected',
        );
        const failedToCloseSockets = socketsResult.filter(
            (r) => r.status === 'rejected',
        );
        if (failedToClosePeers.length || failedToCloseSockets.length) {
            if (failedToClosePeers.length) {
                this.logger.debug(
                    `<< some peers failed to close: ${failedToClosePeers.map((r) => r.reason).join(', ')}`,
                );
            }
            if (failedToCloseSockets.length) {
                this.logger.debug(
                    `<< some sockets failed to close: ${failedToCloseSockets.map((r) => r.reason).join(', ')}`,
                );
            }
        } else {
            this.logger.debug('<<< closed');
        }
    }

    async initChats(chats: SmashChat[]) {
        return Promise.all(
            chats.map(async (chat) => {
                const peerDid = await DIDResolver.resolve(chat.with);
                this.peers[peerDid.id] = await this.getOrCreatePeer(
                    peerDid,
                    chat.lastMessageTimestamp,
                );
            }),
        );
    }

    async setEndpoints(
        newEndpoints: SMEConfigJSONWithoutDefaults[],
    ): Promise<void> {
        this.logger.debug('SmashMessaging::setEndpoints');
        // ASSUMPTION#3: Endpoints can be uniquely identified by their URL.
        // Create lookup map of existing endpoint URLs for O(1) lookups
        const existingUrlMap = new Map(
            this.endpoints.map((endpoint) => [endpoint.url, endpoint]),
        );
        const endpointsToConnect: SMEConfigJSONWithoutDefaults[] = [];
        for (const newEndpoint of newEndpoints) {
            if (existingUrlMap.has(newEndpoint.url)) {
                continue;
            } else {
                endpointsToConnect.push(newEndpoint);
            }
        }
        const newUrlSet = new Set(newEndpoints.map((e) => e.url));
        const endpointsToDisconnect = this.endpoints.filter(
            (endpoint) => !newUrlSet.has(endpoint.url),
        );
        this.logger.debug(
            `Set ${newEndpoints.length} endpoints split: ${endpointsToDisconnect.length} to disconnect, ` +
                `${endpointsToConnect.length} to connect`,
        );

        if (endpointsToDisconnect.length) {
            this.logger.debug(
                `> Disconnecting endpoints: ${endpointsToDisconnect
                    .map((e) => e.url)
                    .join(', ')}`,
            );
            await Promise.allSettled(
                endpointsToDisconnect.map((endpoint) =>
                    this.smeSocketManager.close(endpoint.url),
                ),
            );
        }

        if (endpointsToConnect.length) {
            this.logger.debug(
                `> Connecting new endpoints: ${endpointsToConnect
                    .map((e) => e.url)
                    .join(', ')}`,
            );

            const initEndpoints = await Promise.allSettled(
                endpointsToConnect.map((smeConfig) => {
                    return this.smeSocketManager.initWithAuth(
                        this.identity,
                        {
                            ...SME_DEFAULT_CONFIG,
                            ...smeConfig,
                            // TODO PreKeyPair Management
                            preKeyPair: this.identity.signedPreKeys[0],
                        },
                        this.sessionManager,
                    );
                }),
            );

            const successfulConnections = initEndpoints
                .filter((r) => r.status === 'fulfilled')
                .map((r) => (r as PromiseFulfilledResult<SmashEndpoint>).value);

            this.endpoints.push(...successfulConnections);

            const failedConnections = initEndpoints.filter(
                (r) => r.status === 'rejected',
            );
            if (failedConnections.length) {
                this.logger.warn(
                    `Failed to initialize endpoints: ${failedConnections
                        .map((r) => (r as PromiseRejectedResult).reason)
                        .join(', ')}`,
                );
            }
        }
    }

    private async messagesStatusHandler(messageIds: string[], status: string) {
        this.logger.debug(`messagesStatusHandler "${status}" : ${messageIds}`);
        this.emit('status', status, messageIds);
    }

    private peerIkMapping: Record<string, string> = {};
    private getPeerByIk(peerIk: string) {
        return this.peers[this.peerIkMapping[peerIk]];
    }

    // TODO: split profile from DID updates?
    // TODO: handle differential profile updates?
    // TODO: handle updates from other peers IF signed (and with proper trusting level—ie. not from any peer & only ADDING not replacing/removing endpoints if not from the peer itself )
    private async incomingProfileHandler(
        peerIk: string,
        message: IMProfileMessage,
    ) {
        this.logger.debug(`Received Profile for IK ${peerIk}`);
        const peerDid = await DIDResolver.resolve(message.data.did);
        if (peerIk !== peerDid.ik) {
            // TODO: handle IK upgrades
            const err = 'Received IK doesnt match Signal Session data.';
            this.logger.error(err);
            throw new Error(err);
        }
        // TODO: handle DID updates
        await this.getOrCreatePeer(peerDid);
        // send all pending messages
        return this.flushPeerIkDLQ(peerIk);
    }

    private sendReceivedAcks(
        peer: SmashPeer,
        messages: EncapsulatedIMProtoMessage[],
    ) {
        const acks = messages.filter((m) => m.type !== IM_ACK_RECEIVED);
        if (!acks.length) return;
        this.logger.debug(`sendReceivedAcks: ${acks.length}`);
        return peer.sendMessage({
            type: 'org.improto.ack.received',
            data: acks.map((m) => m.sha256),
        } as IMReceivedACKMessage);
    }

    private deduplicateMessages(messages: EncapsulatedIMProtoMessage[]) {
        const now = Date.now();
        return messages.filter((msg) => {
            if (this.processedMessages.has(msg.sha256)) {
                return false;
            }
            this.processedMessages.set(msg.sha256, now);
            return true;
        });
    }

    private async incomingMessagesHandler(
        peerIk: string,
        messages: EncapsulatedIMProtoMessage[],
    ) {
        const peer: SmashPeer | undefined = this.getPeerByIk(peerIk);
        if (peer) {
            const uniqueMessages = this.deduplicateMessages(messages);
            if (uniqueMessages.length === 0) {
                this.logger.debug(
                    'All messages were duplicates, skipping processing',
                );
                return;
            }
            await Promise.allSettled([
                // firehose incoming events to the library user
                this.notifyNewMessages(peer.id, uniqueMessages),
                // registered message handlers execute resolvers
                this.incomingMessagesParser(peer, uniqueMessages),
                // send received ACKs to the sending peer
                this.sendReceivedAcks(peer, uniqueMessages),
            ]);
            this.logger.info(
                `processed ${uniqueMessages?.length} unique messages from ${peer.id}`,
            );
        } else {
            this.pushToUnknownPeerIkDLQ(peerIk, messages);
            // TODO: handle profile updates (for now only handles IK updates)
            await Promise.allSettled(
                messages
                    .filter((m) => m.type === IM_PROFILE) // TODO: split DID
                    .map((m) =>
                        this.incomingProfileHandler(
                            peerIk,
                            m as IMProfileMessage,
                        ),
                    ),
            );
            this.logger.debug(
                `DLQd ${messages.length} messages from unknown peer (IK: ${peerIk})`,
            );
        }
    }

    private async incomingMessageParser(
        peer: SmashPeer,
        message: EncapsulatedIMProtoMessage,
    ) {
        const handlers = this.messageHandlers.get(message.type);
        if (!handlers?.length) return;
        await Promise.allSettled(
            handlers.map(({ eventName, resolver }) =>
                resolver
                    .resolve(peer, message)
                    .then((result) =>
                        this.emit(
                            eventName,
                            peer.id,
                            result,
                            message.sha256,
                            message.timestamp,
                        ),
                    ),
            ),
        );
    }

    private async incomingMessagesParser(
        peer: SmashPeer,
        messages: EncapsulatedIMProtoMessage[],
    ) {
        await Promise.allSettled(
            messages.map((message) =>
                this.incomingMessageParser(peer, message),
            ),
        );
    }

    /**
     * Firehose incoming events to the library user
     */
    private notifyNewMessages(
        sender: DIDString,
        messages: EncapsulatedIMProtoMessage[],
    ) {
        if (!messages?.length) return;
        this.logger.debug(`notifyNewMessages (${messages?.length})`);
        this.logger.debug(JSON.stringify(messages, null, 2));
        messages.forEach((message) => this.emit('data', sender, message));
    }

    private async flushPeerIkDLQ(peerIk: string) {
        if (!this.dlq[peerIk]?.length) {
            this.logger.info(`Cannot find queue for peer ${peerIk}`);
            return;
        }
        this.logger.debug(
            `> Flushing peer DLQ of size ${this.dlq[peerIk].length}`,
        );
        await this.incomingMessagesHandler(peerIk, this.dlq[peerIk]);
        delete this.dlq[peerIk];
    }

    private pushToUnknownPeerIkDLQ(
        peerIk: string,
        messages: EncapsulatedIMProtoMessage[],
    ) {
        if (!this.dlq[peerIk]) this.dlq[peerIk] = [];
        this.dlq[peerIk].push(...messages);
    }

    protected async getOrCreatePeer(
        did: DID,
        lastMessageTimestamp?: string,
    ): Promise<SmashPeer> {
        // TODO: handle DID updates
        const peerDid = await DIDResolver.resolve(did);
        if (!this.peers[peerDid.id]) {
            this.logger.debug(`CreatePeer ${peerDid.id}`);
            const peer = new SmashPeer(
                peerDid,
                lastMessageTimestamp
                    ? new Date(lastMessageTimestamp).getTime()
                    : 0,
                this.sessionManager,
                this.smeSocketManager,
                this.logger,
            );
            peer.setUserProfile(await this.getProfile());
            await peer.configureEndpoints();
            this.peers[peer.id] = peer;
        }
        // always remap IK to ID (TODO handle profile/DID updates)
        this.peerIkMapping[peerDid.ik] = peerDid.id;
        return this.peers[peerDid.id];
    }

    sendTextMessage(
        peerDid: DID,
        text: string,
        after: string,
    ): Promise<EncapsulatedIMProtoMessage> {
        return this.sendMessage(peerDid, {
            type: IM_CHAT_TEXT,
            data: text,
            after,
        } as IMTextMessage);
    }

    async sendMessage(peerDid: DID, message: IMProtoMessage) {
        const peer = await this.getOrCreatePeer(peerDid);
        return await peer.sendMessage(message);
    }

    async getProfile(): Promise<IMProfile> {
        return {
            ...{
                title: '',
                description: '',
                avatar: '',
            },
            ...this.meta,
            did: await this.getDID(),
        };
    }

    getDID(): Promise<DIDDocument> {
        return SmashMessaging.getDID(this.identity, this.endpoints);
    }

    async updateMeta(meta: ProfileMeta) {
        this.meta = meta;
        const profile = await this.getProfile();
        await Promise.allSettled(
            Object.values(this.peers).map((peer) =>
                peer.sendUserProfile(profile),
            ),
        );
    }

    private static async getDID(
        identity: Identity,
        endpoints: SmashEndpoint[],
    ): Promise<DIDDocument> {
        return {
            // @ts-expect-error TODO: implement DID:key
            id: await CryptoUtils.singleton.sha256(
                identity.signingKey.publicKey.serialize(),
            ),
            ik: await CryptoUtils.singleton.exportKey(
                identity.signingKey.publicKey.key,
            ),
            ek: await CryptoUtils.singleton.exportKey(
                identity.exchangeKey.publicKey.key,
            ),
            signature: await CryptoUtils.singleton.signAsString(
                identity.signingKey.privateKey,
                identity.exchangeKey.publicKey.serialize(),
            ),
            endpoints: await Promise.all(endpoints),
        };
    }

    // TODO demo usage in test suite
    static handleError(
        reason: unknown,
        promise: Promise<unknown>,
        logger: Logger,
    ) {
        if (
            typeof reason === 'object' &&
            reason !== null &&
            'name' in reason &&
            reason.name === 'OperationError'
        ) {
            logger.warn(
                '[SmashMessaging] Decryption OperationError: Possible key mismatch or corrupted data.',
            );
            logger.debug(
                'Detailed cause:',
                (reason as { cause?: string }).cause ||
                    'No additional error cause found',
            );
        } else {
            logger.error(
                '[SmashMessaging] Unhandled rejection at:',
                promise,
                'reason:',
                reason,
            );
        }
    }

    private readonly messageHandlers: Map<
        string,
        {
            eventName: string;
            resolver: BaseResolver<IMProtoMessage, unknown>;
        }[]
    > = new Map();

    /**
     * Register a resolver for a specific message type
     * @param eventName Event name triggered by the library
     * @param resolver Resolver instance that extends BaseResolver
     * @typeparam T Type of messages to resolve
     */
    public register(
        eventName: `data.${string}`,
        resolver: BaseResolver<IMProtoMessage, unknown>,
    ): void {
        this.superRegister(eventName, resolver);
    }
    protected superRegister(
        eventName: string,
        resolver: BaseResolver<IMProtoMessage, unknown>,
    ): void {
        const messageType = resolver.getMessageType();
        if (!this.messageHandlers.has(messageType)) {
            this.messageHandlers.set(messageType, []);
        }
        this.messageHandlers.get(messageType)!.push({ eventName, resolver });
    }

    /**
     * Unregister a specific resolver for a message type
     * @param eventName Event name to unregister
     * @param resolver Resolver instance to unregister
     */
    public unregister(
        eventName: string,
        resolver: BaseResolver<IMProtoMessage, unknown>,
    ): void {
        const messageType = resolver.getMessageType();
        const handlers = this.messageHandlers.get(messageType);
        if (!handlers) return;
        const filteredHandlers = handlers.filter(
            (handler) =>
                handler.eventName !== eventName ||
                handler.resolver !== resolver,
        );
        if (filteredHandlers.length === 0) {
            this.messageHandlers.delete(messageType);
        } else {
            this.messageHandlers.set(messageType, filteredHandlers);
        }
    }

    private cleanupProcessedMessages() {
        const expiryThreshold = Date.now() - SmashMessaging.cacheExpiryTime;
        let count = 0;
        for (const [hash, timestamp] of this.processedMessages) {
            if (timestamp < expiryThreshold) {
                this.processedMessages.delete(hash);
                count++;
            }
        }
        if (count > 0)
            this.logger.debug(`Cleaned up ${count} processed messages (cache)`);
    }
}
