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

    async initEndpoints(endpoints: SMEConfigJSONWithoutDefaults[]) {
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

    private async incomingMessagesHandler(
        messages: EncapsulatedSmashMessage[],
        peerIk: string,
    ) {
        const peer: SmashPeer | undefined = this.getPeerByIk(peerIk);
        if (!peer) {
            this.logger.debug(
                `Messages (${messages.length}) from unknown IK ${peerIk}`,
            );
            this.pushToUnknownPeerIkDLQ(peerIk, messages);
            const catchDidMessages = messages.map(async (message) => {
                if (message.type === 'profile') {
                    this.logger.debug(`Received Profile for IK ${peerIk}`);
                    const peerDid = message.data as SmashProfile;
                    if (peerIk !== peerDid.did.ik) {
                        const err =
                            'Received IK doesnt match Signal Session data.';
                        this.logger.warn(err);
                        throw new Error(err);
                    }
                    await this.flushPeerIkDLQ(peerDid.did);
                } else {
                    throw '';
                }
            });
            return Promise.any(catchDidMessages).catch(() =>
                this.logger.debug(
                    `didnt catch any profile message for ${peerIk}`,
                ),
            );
        } else {
            const peerDid = peer.getDID();
            this.notifyNewMessages(messages, peerDid);
        }
    }

    totalMessages = 0;
    private notifyNewMessages(
        messages: EncapsulatedSmashMessage[],
        sender: SmashDID,
    ) {
        this.logger.debug(
            `notifyNewMessages: ${messages.length}/${(this.totalMessages += messages.length)}`,
            JSON.stringify(messages, null, 2),
        );
        messages.forEach((message) => this.emit('message', message, sender));
    }

    private async flushPeerIkDLQ(peerDid: SmashDID) {
        if (!this.dlq[peerDid.ik])
            throw new Error('Cannot find queue for this peer.');
        this.logger.debug(
            `> Flushing peer DLQ of size ${this.dlq[peerDid.ik].length}`,
        );
        const peer = await this.getOrCreatePeer(peerDid);
        if (peer.getDID().ik !== peerDid.ik)
            throw new Error('Peer IK mismatch.');
        this.notifyNewMessages(this.dlq[peerDid.ik], peerDid);
        delete this.dlq[peerDid.ik];
    }

    private pushToUnknownPeerIkDLQ(
        peerIk: string,
        messages: EncapsulatedSmashMessage[],
    ) {
        if (!this.dlq[peerIk]) this.dlq[peerIk] = [];
        this.dlq[peerIk].push(...messages);
    }

    protected async getOrCreatePeer(peerDid: SmashDID): Promise<SmashPeer> {
        if (!this.peers[peerDid.id]) {
            const peer = new SmashPeer(
                peerDid,
                this.sessionManager,
                this.logger,
            );
            await peer.configureEndpoints(this.smeSocketManager);
            peer.queueMessage({
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
        });
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
