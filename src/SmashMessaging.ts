import { Curve, Identity, setEngine } from '2key-ratchet';
import { SmashPeer } from '@src/SmashPeer.js';
import { BaseResolver, DataForwardingResolver } from '@src/callbacks/index.js';
import { DIDResolver } from '@src/did/index.js';
import { SessionManager } from '@src/signal/index.js';
import { SMESocketManager } from '@src/sme/index.js';
import {
    DID,
    DIDDocument,
    DIDString,
    EncapsulatedIMProtoMessage,
    IECKeyPair,
    IJsonIdentity,
    IMProfile,
    IMProfileMessage,
    IMProtoMessage,
    IMTextMessage,
    IM_CHAT_TEXT,
    IM_PROFILE,
    IM_SESSION_RESET,
    SMEConfigJSONWithoutDefaults,
    SME_DEFAULT_CONFIG,
    SmashEndpoint,
} from '@src/types/index.js';
import { LogLevel, Logger } from '@src/utils/Logger.js';
import { CryptoUtils } from '@src/utils/index.js';
import { EventEmitter } from 'events';

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

class SessionResetHandler extends BaseResolver<IMProtoMessage, void> {
    resolve(
        peer: SmashPeer,
        message: EncapsulatedIMProtoMessage,
    ): Promise<void> {
        return peer.incomingSessionReset(message.sha256);
    }
}

// TODO: refactor
// TODO: safeguard crypto operations against errors
// TODO: split beteen IMProto and Smash Messaging
export class SmashMessaging extends EventEmitter {
    protected logger: Logger;
    private static crypto: globalThis.Crypto;

    static setCrypto(c: globalThis.Crypto) {
        this.crypto = c;
        setEngine('@peculiar/webcrypto', c);
        CryptoUtils.setCryptoSubtle(c.subtle);
    }

    private static patchedGenerateKey: boolean = false;
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

    private dlq: Record<string, EncapsulatedIMProtoMessage[]>;
    private peers: Record<string, SmashPeer>;
    private endpoints: SmashEndpoint[];
    private sessionManager: SessionManager;
    private smeSocketManager: SMESocketManager;

    constructor(
        protected identity: Identity,
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
        this.logger.info(`Loaded Smash lib (log level: ${LOG_LEVEL})`);
    }

    async close() {
        await this.smeSocketManager.closeAllSockets();
        this.endpoints = [];
        return;
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

    async initEndpoints(
        endpoints: SMEConfigJSONWithoutDefaults[],
    ): Promise<void> {
        const newEndpoints = await Promise.all(
            endpoints.map((smeConfig) => {
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
        this.endpoints = this.endpoints.concat(newEndpoints);
    }

    private async messagesStatusHandler(messageIds: string[], status: string) {
        this.logger.debug(`messagesStatusHandler ${status} ${messageIds}`);
        messageIds.forEach((id) => this.emit('status', id, status));
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

    private async incomingMessagesHandler(
        peerIk: string,
        messages: EncapsulatedIMProtoMessage[],
    ) {
        const peer: SmashPeer | undefined = this.getPeerByIk(peerIk);
        if (peer) {
            // firehose incoming events to the library user
            this.notifyNewMessages(peer.id, messages);
            // registered message handlers execute resolvers
            await this.incomingMessagesParser(peer, messages);
            this.logger.info(
                `processed ${messages?.length} messages from ${peer.id}`,
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
            await peer.configureEndpoints();
            await peer.queueMessage({
                type: IM_PROFILE,
                data: await this.getProfile(),
                after: '',
            } as IMProfileMessage);
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
        await Promise.all(
            Object.values(this.peers).map((peer) =>
                peer.sendMessage({
                    type: IM_PROFILE,
                    data: profile,
                } as IMProfileMessage),
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

    private messageHandlers: Map<
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
}
