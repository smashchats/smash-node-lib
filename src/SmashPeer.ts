import { IM_RESET_SESSION_MESSAGE } from '@src/const.js';
import { DIDResolver } from '@src/did/index.js';
import { SessionManager, SignalSession } from '@src/signal/index.js';
import { SMESocketManager, SMESocketWriteOnly } from '@src/sme/index.js';
import {
    DID,
    DIDDocument,
    DIDString,
    EncapsulatedIMProtoMessage,
    IMProtoMessage,
    ISO8601,
    Relationship,
    SmashEndpoint,
} from '@src/types/index.js';
import { Logger } from '@src/utils/Logger.js';
import { CryptoUtils } from '@src/utils/index.js';
import AsyncLock from 'async-lock';

export class SmashPeer {
    // TODO subscribe on changes like updates to DID, IK, EK, PK...
    // TODO session resets
    private endpoints: {
        peerId: string;
        socket: SMESocketWriteOnly;
        session: SignalSession;
        messageQueue: Set<EncapsulatedIMProtoMessage>;
    }[] = [];

    private messageQueue: Set<EncapsulatedIMProtoMessage> = new Set();

    // TODO allow loading relationship at lib initialization time
    private relationship: Relationship = 'clear';
    private lastRelationshipSha256: string = '0';

    // TODO: default to use 'id' everywhere document is not needed
    public readonly id: DIDString;

    constructor(
        private did: DID,
        private lastMessageTime: number,
        private sessionManager: SessionManager,
        private smeSocketManager: SMESocketManager,
        private logger: Logger,
    ) {
        this.id = typeof did === 'string' ? did : did.id;
    }

    // TODO: should validate endpointConfig.preKey signature!!!
    private async createEndpoint(endpointConfig: SmashEndpoint) {
        const socket = this.smeSocketManager.getOrCreate(endpointConfig.url);
        return {
            peerId: endpointConfig.preKey,
            socket,
            session: await this.sessionManager.initSession(
                await this.getDID(),
                endpointConfig,
            ),
            messageQueue: new Set(this.messageQueue),
        };
    }

    async configureEndpoints(sendSessionReset: boolean = true): Promise<void> {
        const did = await this.getDID();
        this.logger.debug(`configureEndpoints (${did.endpoints.length})`);
        let shouldSendSessionReset = false;
        this.endpoints = await Promise.all(
            did.endpoints.map(async (endpointConfig: SmashEndpoint) => {
                // if last message is before session TTL,
                // then we need to send a session reset message
                // to let the other peer know that the session has been renewed earlier than expected
                if (
                    Date.now() - this.lastMessageTime <
                    SignalSession.SESSION_TTL_MS
                ) {
                    shouldSendSessionReset = true;
                }
                return this.createEndpoint(endpointConfig);
            }),
        );
        if (shouldSendSessionReset && sendSessionReset) {
            await this.triggerSessionReset();
        }
        await this.flushQueue();
    }

    // TODO: reset session
    // TODO: refresh DID

    async queueMessage(message: IMProtoMessage) {
        const timestamp = new Date().toISOString() as ISO8601;
        const sha256 = await CryptoUtils.singleton.sha256fromObject({
            ...message,
            timestamp,
        });
        const encapsulatedMessage = { ...message, sha256, timestamp };
        this.messageQueue.add(encapsulatedMessage);
        for (const endpoint of this.endpoints) {
            endpoint.messageQueue.add(encapsulatedMessage);
        }
        this.logger.debug(
            `> queued ${encapsulatedMessage.sha256} (${this.messageQueue.size})`,
        );
        return encapsulatedMessage;
        // TODO: when to clear the general message queue?? (on Received not implemented)
    }

    async flushQueue() {
        // To send a message to Bob we need
        // - 1) a valid SignalSession with Bob, AND
        // - 2) (a) an open P2P RTC pipe with Bob, OR (b) Bob's SMEs.
        // If we miss either condition ((1) or (2)),
        //   then we should re-establish the protocol.
        // TODO: pick either P2P or Endpoints

        const hasExpiredEndpoints = this.endpoints.some((endpoint) =>
            endpoint.session.isExpired(),
        );
        if (hasExpiredEndpoints) {
            this.logger.debug('hasExpiredEndpoints');
            await this.configureEndpoints();
        }

        await Promise.allSettled(
            this.endpoints.map(async (endpoint) => {
                const undeliveredMessages = Array.from(endpoint.messageQueue);
                endpoint.socket.sendData(
                    endpoint.peerId,
                    endpoint.session.id,
                    await endpoint.session.encryptMessages(undeliveredMessages),
                    undeliveredMessages.map((m) => m.sha256),
                );
                endpoint.messageQueue.clear();
                this.logger.debug(
                    `> flushed ${undeliveredMessages.length} messages to ${endpoint.socket.url}`,
                );
            }),
        );
        // TODO: where to handle retries? (is refactor needed? rethink clean lib arch?)
    }

    async sendMessage(
        message: IMProtoMessage,
    ): Promise<EncapsulatedIMProtoMessage> {
        const sentMessage = await this.queueMessage(message);
        await this.flushQueue();
        this.logger.debug(`> sent `, JSON.stringify(sentMessage));
        return sentMessage;
    }

    getDID(): Promise<DIDDocument> {
        return DIDResolver.resolve(this.did);
    }

    // getRelationship() {
    //     return this.relationship;
    // }

    async setRelationship(relationship: Relationship, nabs: SmashPeer[]) {
        if (this.relationship === relationship) {
            return;
        }
        // TODO: suppport multiple NABs
        // WARN: assume we only have one NAB to update
        const nab = nabs[0];
        const did = await this.getDID();
        const updateNabMessage = await nab.sendMessage({
            type: 'com.smashchats.relationship',
            data: { target: did.id, action: relationship },
            after: this.lastRelationshipSha256,
        });
        this.lastRelationshipSha256 = updateNabMessage.sha256;
        this.relationship = relationship;
        this.logger.info(
            `> setRelationship with ${did.id} to ${relationship} (${updateNabMessage.sha256})`,
        );
        // const updateNabPromises = nabs.map((nab) =>
        //     nab.sendMessage({
        //         type: 'action',
        //         data: { target: this.did, action: relationship },
        //         after: '0',
        //     }),
        // );
        // const results = await Promise.allSettled(updateNabPromises);
        // this.logger.info(
        //     `> setRelationship with ${this.did.id} to ${relationship}`,
        //     JSON.stringify(results),
        // );
    }

    private async resetSessions(keepActive: boolean = false) {
        const did = await this.getDID();
        await this.sessionManager.handleSessionReset(did.ik, keepActive);
        await this.configureEndpoints(false);
    }

    async triggerSessionReset(): Promise<EncapsulatedIMProtoMessage> {
        this.logger.debug(
            `Triggering session reset for ${
                typeof this.did === 'string' ? this.did : this.did.id
            }`,
        );
        await this.resetSessions();
        return this.sendMessage(IM_RESET_SESSION_MESSAGE);
    }

    private alreadyProcessedSessionReset: string[] = [];
    private sessionResetMutex = new AsyncLock();

    async incomingSessionReset(sha256: string) {
        await this.sessionResetMutex.acquire('sessionReset', async () => {
            if (this.alreadyProcessedSessionReset.includes(sha256)) {
                this.logger.debug(
                    `Already processed session reset ${sha256}, skipping`,
                );
                return;
            }
            this.logger.debug(`Processing session reset ${sha256}`);
            await this.resetSessions(true);
            this.alreadyProcessedSessionReset.push(sha256);
        });
    }
}
