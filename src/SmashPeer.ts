import CryptoUtils from '@src/CryptoUtils.js';
import { Logger } from '@src/Logger.js';
import { SMESocketManager } from '@src/SMESocketManager.js';
import { SMESocketWriteOnly } from '@src/SMESocketWriteOnly.js';
import { SessionManager } from '@src/SessionManager.js';
import { SignalSession } from '@src/SignalSession.js';
import {
    EncapsulatedSmashMessage,
    Relationship,
    SessionResetSmashMessage,
    SmashDID,
    SmashEndpoint,
    SmashMessage,
} from '@src/types/index.js';
import AsyncLock from 'async-lock';

export class SmashPeer {
    // TODO subscribe on changes like updates to DID, IK, EK, PK...
    // TODO session resets
    private endpoints: {
        peerId: string;
        socket: SMESocketWriteOnly;
        session: SignalSession;
        messageQueue: Set<EncapsulatedSmashMessage>;
    }[] = [];

    private messageQueue: Set<EncapsulatedSmashMessage> = new Set();

    // TODO allow loading relationship at lib initialization time
    private relationship: Relationship = 'clear';
    private lastRelationshipSha256: string = '0';

    constructor(
        private did: SmashDID,
        private lastMessageTime: number,
        private sessionManager: SessionManager,
        private smeSocketManager: SMESocketManager,
        private logger: Logger,
    ) {}

    // TODO: should validate endpointConfig.preKey signature!!!
    private async createEndpoint(endpointConfig: SmashEndpoint) {
        const socket = this.smeSocketManager.getOrCreate(endpointConfig.url);
        return {
            peerId: endpointConfig.preKey,
            socket,
            session: await this.sessionManager.initSession(
                this.did,
                endpointConfig,
            ),
            messageQueue: new Set(this.messageQueue),
        };
    }

    async configureEndpoints(sendSessionReset: boolean = true): Promise<void> {
        this.logger.debug(`configureEndpoints (${this.did.endpoints.length})`);
        let shouldSendSessionReset = false;
        this.endpoints = await Promise.all(
            this.did.endpoints.map(async (endpointConfig: SmashEndpoint) => {
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

    async queueMessage(message: SmashMessage) {
        const timestamp = new Date().toISOString();
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
        message: SmashMessage,
    ): Promise<EncapsulatedSmashMessage> {
        const sentMessage = await this.queueMessage(message);
        await this.flushQueue();
        this.logger.debug(`> sent `, JSON.stringify(sentMessage));
        return sentMessage;
    }

    getDID() {
        return this.did;
    }

    // getRelationship() {
    //     return this.relationship;
    // }

    async setRelationship(relationship: Relationship, nabs: SmashPeer[]) {
        if (this.relationship === relationship) {
            return;
        }
        // TODO: assume we only have one NAB to update
        const nab = nabs[0];
        const updateNabMessage = await nab.sendMessage({
            type: 'action',
            data: { target: this.did, action: relationship },
            after: this.lastRelationshipSha256,
        });
        this.lastRelationshipSha256 = updateNabMessage.sha256;
        this.relationship = relationship;
        this.logger.info(
            `> setRelationship with ${this.did.id} to ${relationship} (${updateNabMessage.sha256})`,
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

    private async resetSessions() {
        await this.sessionManager.handleSessionReset(this);
        await this.configureEndpoints(false);
    }

    async triggerSessionReset(): Promise<EncapsulatedSmashMessage> {
        this.logger.debug(`Triggering session reset for ${this.did.ik}`);
        await this.resetSessions();
        return this.sendMessage({
            type: 'session_reset',
        } as SessionResetSmashMessage);
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
            await this.resetSessions();
            this.alreadyProcessedSessionReset.push(sha256);
        });
    }
}
