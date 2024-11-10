import CryptoUtils from '@src/CryptoUtils.js';
import { Logger } from '@src/Logger.js';
import { SMESocketManager } from '@src/SMESocketManager.js';
import { SMESocketWriteOnly } from '@src/SMESocketWriteOnly.js';
import { SessionManager } from '@src/SessionManager.js';
import { SignalSession } from '@src/SignalSession.js';
import {
    EncapsulatedSmashMessage,
    Relationship,
    SmashDID,
    SmashMessage,
} from '@src/types/index.js';

export class SmashPeer {
    // TODO subscribe on changes like updates to DID, IK, EK, PK...
    // TODO session resets
    private endpoints: {
        peerId: string;
        socket: SMESocketWriteOnly;
        session: SignalSession;
    }[] = [];
    private messageQueue: EncapsulatedSmashMessage[] = [];

    // TODO allow loading relationship at lib initialization time
    private relationship: Relationship = 'clear';

    constructor(
        private did: SmashDID,
        private sessionManager: SessionManager,
        private logger: Logger,
    ) {}

    async configureEndpoints(
        smeSocketManager: SMESocketManager,
    ): Promise<void> {
        this.logger.debug('SmashPeer::configureEndpoints');
        const endpointPromises = this.did.endpoints.map(
            async (endpointConfig) => {
                const socket = smeSocketManager.getOrCreate(endpointConfig.url);
                this.endpoints.push({
                    peerId: endpointConfig.preKey,
                    socket,
                    session: await this.sessionManager.initSession(
                        this.did,
                        endpointConfig,
                    ),
                });
            },
        );
        await Promise.all(endpointPromises);
    }

    // TODO: reset session
    // TODO: refresh DID

    async queueMessage(message: SmashMessage) {
        const encapsulatedMessage = {
            ...message,
            sha256: await CryptoUtils.singleton.sha256(
                Buffer.from(JSON.stringify(message)),
            ),
            timestamp: new Date().toISOString(),
        };
        this.messageQueue.push(encapsulatedMessage);
        this.logger.debug(
            `> queued ${encapsulatedMessage.sha256} (${this.messageQueue.length})`,
        );
        return encapsulatedMessage;
    }

    async flushQueue() {
        // To send a message to Bob we need
        // - 1) a valid SignalSession with Bob, AND
        // - 2) (a) an open P2P RTC pipe with Bob, OR (b) Bob's SMEs.
        // If we miss either condition ((1) or (2)),
        //   then we should re-establish the protocol.
        // TODO: pick either P2P or Endpoints
        const queuedMessages = [...this.messageQueue];
        const queuedMessagesSha256s = queuedMessages.map((m) => m.sha256);
        await Promise.allSettled(
            this.endpoints.map(async (endpoint) => {
                endpoint.socket.sendData(
                    endpoint.peerId,
                    endpoint.session.id,
                    Buffer.from(
                        await endpoint.session.encryptMessages(queuedMessages),
                    ),
                    queuedMessagesSha256s,
                );
                this.messageQueue = [];
            }),
        );
        this.logger.debug(
            `> flushed ${queuedMessages.length - this.messageQueue.length}/${queuedMessages.length} (${queuedMessagesSha256s})`,
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
        this.relationship = relationship;
        const updateNabPromises = nabs.map((nab) =>
            nab.sendMessage({
                type: 'action',
                data: { target: this.did, action: relationship },
            }),
        );
        const results = await Promise.allSettled(updateNabPromises);
        this.logger.info(
            `> setRelationship with ${this.did.id} to ${relationship}`,
            JSON.stringify(results),
        );
    }
}
