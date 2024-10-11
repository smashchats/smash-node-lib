import {
    Curve,
    IECKeyPair,
    IJsonIdentity,
    Identity,
    setEngine,
} from '2key-ratchet';
import { CryptoKey } from '@peculiar/webcrypto';
import CryptoUtils from '@src/CryptoUtils.js';
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
} from '@src/types/index.js';
import { EventEmitter } from 'events';

type CryptoKeyPair = {
    privateKey: CryptoKey;
    publicKey: CryptoKey;
    thumbprint: string;
};

export default class SmashMessaging extends EventEmitter {
    static setCrypto(c: globalThis.Crypto) {
        setEngine('@peculiar/webcrypto', c);
        CryptoUtils.setCryptoSubtle(c.subtle);
    }

    static generateIdentity() {
        return Identity.create(0, 1, 0, false);
    }

    static async parseIdentityJson(
        identity: IJsonIdentity,
        ecKeyPairFromJson?: (keys: CryptoKeyPair) => Promise<IECKeyPair>,
    ) {
        if (!!ecKeyPairFromJson) Curve.ecKeyPairFromJson = ecKeyPairFromJson;
        return await Identity.fromJSON(identity);
    }

    private dlq: Record<string, EncapsulatedSmashMessage[]>;
    private peers: Record<string, SmashPeer>;
    private endpoints: SmashEndpoint[];
    private sessionManager: SessionManager;
    private smeSocketManager: SMESocketManager;
    // private processingDlq: boolean;

    constructor(protected identity: Identity) {
        super();
        this.dlq = {};
        this.peers = {};
        this.endpoints = [];
        this.sessionManager = new SessionManager(identity);
        this.smeSocketManager = new SMESocketManager(
            this.incomingMessagesHandler.bind(this),
            this.messagesStatusHandler.bind(this),
        );
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
        console.debug(`messagesStatusHandler ${status} ${messageIds}`);
        messageIds.forEach((id) => this.emit('status', id, status));
    }

    private async incomingMessagesHandler(
        messages: EncapsulatedSmashMessage[],
        peerIk: string,
    ) {
        const peer: SmashPeer | undefined = this.peers[peerIk];
        if (!peer) {
            console.debug(
                `Messages (${messages.length}) from unknown peer ${peerIk}`,
            );
            this.pushToUnknownPeerDLQ(peerIk, messages);
            const catchDidMessages = messages.map(async (message) => {
                if (message.type === 'profile') {
                    console.debug(`Received DID for peer ${peerIk}`);
                    const peerDid = message.data as SmashDID;
                    if (peerIk !== peerDid.ik) {
                        const err =
                            'Received DID doesnt match Signal Session data.';
                        console.warn(err);
                        throw new Error(err);
                    }
                    await this.flushDLQ(peerDid);
                } else {
                    throw '';
                }
            });
            return Promise.any(catchDidMessages).catch(() =>
                console.debug(`didnt catch any profile message for ${peerIk}`),
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
        console.debug(
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
        console.debug(
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
            const peer = new SmashPeer(peerDid, this.sessionManager);
            await peer.configureEndpoints(this.smeSocketManager);
            peer.queueMessage({
                type: 'profile',
                data: await this.getDID(),
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

    getDID(): Promise<SmashDID> {
        return SmashMessaging.getDID(this.identity, this.endpoints);
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
}
