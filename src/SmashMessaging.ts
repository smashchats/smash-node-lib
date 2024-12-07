import {
    Curve,
    IECKeyPair,
    IJsonIdentity,
    Identity,
    setEngine,
} from '2key-ratchet';
import CryptoUtils from '@src/CryptoUtils.js';
import { LogLevel, Logger } from '@src/Logger.js';
import { SMESocketManager } from '@src/SMESocketManager.js';
import { SessionManager } from '@src/SessionManager.js';
import { SmashPeer } from '@src/SmashPeer.js';
import {
    EncapsulatedSmashMessage,
    ProfileSmashMessage,
    SMEConfigJSONWithoutDefaults,
    SME_DEFAULT_CONFIG,
    SmashChatMessage,
    SmashDID,
    SmashEndpoint,
    SmashMessage,
    SmashProfile,
    SmashProfileMeta,
} from '@src/types/index.js';
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
    with: SmashDID;
    lastMessageTimestamp: string;
}

// TODO: retry in case message does not successfully send??
// TODO: safeguard crypto operations against errors
export default class SmashMessaging extends EventEmitter {
    private logger: Logger;
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

    private dlq: Record<string, EncapsulatedSmashMessage[]>;
    private peers: Record<string, SmashPeer>;
    private endpoints: SmashEndpoint[];
    private sessionManager: SessionManager;
    private smeSocketManager: SMESocketManager;
    // private processingDlq: boolean;

    constructor(
        protected identity: Identity,
        private meta?: SmashProfileMeta,
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

        this.logger.info(`Loaded Smash lib (log level: ${LOG_LEVEL})`);
    }

    async close() {
        await this.smeSocketManager.closeAllSockets();
        this.endpoints = [];
        return;
    }

    async initChats(chats: SmashChat[]) {
        chats.forEach(async (chat) => {
            this.peers[chat.with.id] = await this.getOrCreatePeer(
                chat.with,
                chat.lastMessageTimestamp,
            );
        });
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
        message: ProfileSmashMessage,
    ) {
        this.logger.debug(`Received Profile for IK ${peerIk}`);
        const peerDid = message.data.did;
        if (peerIk !== peerDid.ik) {
            // TODO: handle IK upgrades
            const err = 'Received IK doesnt match Signal Session data.';
            this.logger.error(err);
            throw new Error(err);
        }
        // send all pending messages
        await this.getOrCreatePeer(peerDid);
        await this.flushPeerIkDLQ(peerIk);
    }

    private async incomingMessagesHandler(
        peerIk: string,
        messages: EncapsulatedSmashMessage[],
    ) {
        const peer: SmashPeer | undefined = this.getPeerByIk(peerIk);
        if (!peer) {
            this.logger.debug(
                `DLQd ${messages.length} messages from unknown peer (IK: ${peerIk})`,
            );
            this.pushToUnknownPeerIkDLQ(peerIk, messages);
        } else {
            const peerDid = peer.getDID();
            this.notifyNewMessages(messages, peerDid);
        }
        await Promise.all(
            messages.map(async (message) => {
                switch (message.type) {
                    case 'profile':
                        this.incomingProfileHandler(
                            peerIk,
                            message as ProfileSmashMessage,
                        );
                        break;
                    case 'session_reset':
                        this.sessionManager.handleSessionReset(peer);
                        break;
                }
            }),
        );
    }

    totalMessages = 0;
    private notifyNewMessages(
        messages: EncapsulatedSmashMessage[],
        sender: SmashDID,
    ) {
        if (!messages?.length) return;
        this.logger.debug(
            `notifyNewMessages: ${messages?.length}/${(this.totalMessages += messages?.length)}`,
            JSON.stringify(messages, null, 2),
        );
        messages.forEach((message) => this.emit('message', message, sender));
    }

    private async flushPeerIkDLQ(peerIk: string) {
        if (!this.dlq[peerIk]?.length) {
            this.logger.info(`Cannot find queue for peer ${peerIk}`);
            return;
        }
        this.logger.debug(
            `> Flushing peer DLQ of size ${this.dlq[peerIk].length}`,
        );
        this.incomingMessagesHandler(peerIk, this.dlq[peerIk]);
        delete this.dlq[peerIk];
    }

    private pushToUnknownPeerIkDLQ(
        peerIk: string,
        messages: EncapsulatedSmashMessage[],
    ) {
        if (!this.dlq[peerIk]) this.dlq[peerIk] = [];
        this.dlq[peerIk].push(...messages);
    }

    protected async getOrCreatePeer(
        peerDid: SmashDID,
        lastMessageTimestamp?: string,
    ): Promise<SmashPeer> {
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
                type: 'profile',
                data: await this.getProfile(),
            } as ProfileSmashMessage);
            this.peers[peerDid.id] = peer;
            this.peerIkMapping[peerDid.ik] = peerDid.id;
        }
        return this.peers[peerDid.id];
    }

    sendTextMessage(
        peerDid: SmashDID,
        text: string,
        after: string,
    ): Promise<EncapsulatedSmashMessage> {
        return this.sendMessage(peerDid, {
            type: 'text',
            data: text,
            after,
        } as SmashChatMessage);
    }

    async sendMessage(peerDid: SmashDID, message: SmashMessage) {
        const peer = await this.getOrCreatePeer(peerDid);
        return await peer.sendMessage(message);
    }

    async getProfile(): Promise<SmashProfile> {
        return {
            meta: this.meta,
            did: await this.getDID(),
        };
    }

    getDID(): Promise<SmashDID> {
        return SmashMessaging.getDID(this.identity, this.endpoints);
    }

    async updateMeta(meta: SmashProfileMeta) {
        this.meta = meta;
        const profile = await this.getProfile();
        await Promise.all(
            Object.values(this.peers).map((peer) =>
                peer.sendMessage({
                    type: 'profile',
                    data: profile,
                } as ProfileSmashMessage),
            ),
        );
    }

    private static async getDID(
        identity: Identity,
        endpoints: SmashEndpoint[],
    ): Promise<SmashDID> {
        return {
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
}
