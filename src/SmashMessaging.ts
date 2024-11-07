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

type CryptoKeyPairWithThumbprint = CryptoKeyPair & {
    thumbprint: string;
};

// TODO: retry in case message does not successfully send??
// TODO: safeguard crypto operations against errors
export default class SmashMessaging extends EventEmitter {
    private logger: Logger;

    static setCrypto(c: globalThis.Crypto) {
        setEngine('@peculiar/webcrypto', c);
        CryptoUtils.setCryptoSubtle(c.subtle);
    }

    static generateIdentity() {
        return Identity.create(0, 1, 0, false);
    }

    static async parseIdentityJson(
        identity: IJsonIdentity,
        ecKeyPairFromJson?: (
            keys: CryptoKeyPairWithThumbprint,
        ) => Promise<IECKeyPair>,
    ) {
        try {
            if (!!ecKeyPairFromJson)
                Curve.ecKeyPairFromJson = ecKeyPairFromJson;
            return await Identity.fromJSON(identity);
        } catch (err) {
            console.error('Cannot parse identity json.');
            throw err;
        }
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
        process.on('unhandledRejection', (reason, promise) => {
            SmashMessaging.handleError(reason, promise, this.logger);
        });
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

    private async incomingMessagesHandler(
        messages: EncapsulatedSmashMessage[],
        peerIk: string,
    ) {
        const peer: SmashPeer | undefined = this.peers[peerIk];
        if (!peer) {
            this.logger.debug(
                `Messages (${messages.length}) from unknown peer ${peerIk}`,
            );
            this.pushToUnknownPeerDLQ(peerIk, messages);
            const catchDidMessages = messages.map(async (message) => {
                if (message.type === 'profile') {
                    this.logger.debug(`Received Profile for peer ${peerIk}`);
                    const peerDid = message.data as SmashProfile;
                    if (peerIk !== peerDid.did.ik) {
                        const err =
                            'Received DID doesnt match Signal Session data.';
                        this.logger.warn(err);
                        throw new Error(err);
                    }
                    await this.flushDLQ(peerDid.did);
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

    private async flushDLQ(peerDid: SmashDID) {
        if (!this.dlq[peerDid.ik])
            throw new Error('Cannot find queue for this peer.');
        // TODO more than once
        // if (this.processingDlq) return;
        // this.processingDlq = true;
        this.logger.debug(
            `> Flushing peer DLQ of size ${this.dlq[peerDid.ik].length}`,
        );
        this.peers[peerDid.ik] = await this.getOrCreatePeer(peerDid);
        this.notifyNewMessages(this.dlq[peerDid.ik], peerDid);
        delete this.dlq[peerDid.ik];
    }

    private pushToUnknownPeerDLQ(
        peerIk: string,
        messages: EncapsulatedSmashMessage[],
    ) {
        if (!this.dlq[peerIk]) this.dlq[peerIk] = [];
        this.dlq[peerIk].push(...messages);
    }

    protected async getOrCreatePeer(peerDid: SmashDID): Promise<SmashPeer> {
        if (!this.peers[peerDid.ik]) {
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
            this.peers[peerDid.ik] = peer;
        }
        return this.peers[peerDid.ik];
    }

    sendTextMessage(
        peerDid: SmashDID,
        text: string,
        after?: string,
    ): Promise<EncapsulatedSmashMessage> {
        return this.sendMessage(
            peerDid,
            {
                type: 'text',
                data: text,
            },
            after,
        );
    }

    async sendMessage(
        peerDid: SmashDID,
        message: SmashMessage,
        after?: string,
    ) {
        const peer = await this.getOrCreatePeer(peerDid);
        return await peer.sendMessage({ ...message, after });
    }

    async getProfile(): Promise<SmashProfile> {
        return {
            meta: this.meta,
            did: await this.getDID(),
        }
    }

    getDID(): Promise<SmashDID> {
        return SmashMessaging.getDID(this.identity, this.endpoints);
    }

    async updateMeta(meta: SmashProfileMeta) {
        this.meta = meta;
        const profile = await this.getProfile();
        await Promise.all(Object.values(this.peers).map(
            peer =>
                peer.sendMessage({
                    type: 'profile',
                    data: profile,
                } as ProfileSmashMessage)
        ));
    }

    private static async getDID(
        identity: Identity,
        endpoints: SmashEndpoint[],
    ): Promise<SmashDID> {
        return {
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

    static handleError(reason: any, promise: Promise<any>, logger: Logger) {
        if (
            reason instanceof DOMException &&
            reason.name === 'OperationError'
        ) {
            logger.warn(
                '[SmashMessaging] Decryption OperationError: Possible key mismatch or corrupted data.',
            );
            logger.debug(
                'Detailed cause:',
                (reason as any).cause || 'No additional error cause found',
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
