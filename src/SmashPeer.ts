import { IM_RESET_SESSION_MESSAGE } from '@src/const.js';
import { DIDResolver } from '@src/did/index.js';
import { SessionManager, SignalSession } from '@src/signal/index.js';
import { SMESocketManager, SmashPeerEndpoint } from '@src/sme/index.js';
import {
    DID,
    DIDDocument,
    DIDString,
    EncapsulatedIMProtoMessage,
    IMProfile,
    IMProfileMessage,
    IMProtoMessage,
    IM_PROFILE,
    ISO8601,
    Relationship,
    SMASH_NBH_RELATIONSHIP,
    SmashEndpoint,
    sha256,
} from '@src/types/index.js';
import { Logger } from '@src/utils/Logger.js';
import { CryptoUtils } from '@src/utils/index.js';
import AsyncLock from 'async-lock';
import { clearTimeout, setTimeout } from 'timers';

export class SmashPeer {
    // TODO subscribe on changes like updates to DID, IK, EK, PK...
    private endpoints: SmashPeerEndpoint[] = [];

    private readonly messageQueue: Set<EncapsulatedIMProtoMessage> = new Set();

    // TODO allow loading relationship at lib initialization time
    private relationship: Relationship = 'clear';
    private lastRelationshipSha256: sha256 | undefined;

    // TODO: default to use 'id' everywhere document is not needed
    public readonly id: DIDString;

    private readonly MAX_RETRY_ATTEMPTS = 5;
    private readonly INITIAL_RETRY_DELAY_MS = 1000;
    private readonly MAX_RETRY_DELAY_MS = 120000; // 2 minutes

    constructor(
        private readonly did: DID,
        private readonly lastMessageTime: number,
        public readonly sessionManager: SessionManager,
        public readonly smeSocketManager: SMESocketManager,
        public readonly logger: Logger,
    ) {
        this.id = typeof did === 'string' ? did : did.id;
    }

    getDID(): Promise<DIDDocument> {
        return DIDResolver.resolve(this.did);
    }

    async sendUserProfile(profile: IMProfile) {
        this.setUserProfile(profile);
        this.logger.debug(`> sending user profile for ${this.id}`);
        await this.queueEncapsulatedMessage(
            await this.getEncapsulatedProfileMessage(),
        );
        await this.flushQueue();
    }

    private cachedUserProfile: IMProfile | undefined;
    setUserProfile(profile: IMProfile) {
        this.cachedUserProfile = profile;
        this.cachedEncapsulatedUserProfile = undefined;
    }

    private cachedEncapsulatedUserProfile:
        | EncapsulatedIMProtoMessage
        | undefined;
    async getEncapsulatedProfileMessage(): Promise<EncapsulatedIMProtoMessage> {
        if (!this.cachedUserProfile) {
            throw new Error('User profile not set');
        }
        if (!this.cachedEncapsulatedUserProfile) {
            this.cachedEncapsulatedUserProfile = await this.encapsulateMessage({
                type: IM_PROFILE,
                data: this.cachedUserProfile,
            } as IMProfileMessage);
        }
        return this.cachedEncapsulatedUserProfile;
    }

    async setRelationship(relationship: Relationship, nabs: SmashPeer[]) {
        if (this.relationship === relationship) {
            return;
        }
        // ASSUMPTION#4: for now, we assume we only have one NAB to update
        const nab = nabs[0];
        const updateNabMessage = await nab.sendMessage({
            type: SMASH_NBH_RELATIONSHIP,
            data: { target: this.id, action: relationship },
            after: this.lastRelationshipSha256,
        });
        this.lastRelationshipSha256 = updateNabMessage.sha256;
        this.relationship = relationship;
        this.logger.info(
            `> setRelationship with ${this.id} to ${relationship} (${updateNabMessage.sha256})`,
        );
    }

    async configureEndpoints(sendSessionReset: boolean = true): Promise<void> {
        if (
            sendSessionReset &&
            Date.now() - this.lastMessageTime < SignalSession.SESSION_TTL_MS
        ) {
            // if last message is before session TTL,
            // then we need to send a session reset message
            // to let the other peer know that our sessions have been renewed earlier than expected
            await this.triggerSessionReset();
        } else {
            const did = await this.getDID();
            this.logger.debug(
                `SmashPeer::configureEndpoints for peer ${this.id} (${did.endpoints.length})`,
            );
            this.endpoints = did.endpoints.map(
                (endpointConfig: SmashEndpoint) =>
                    new SmashPeerEndpoint(
                        this,
                        endpointConfig,
                        this.messageQueue,
                    ),
            );
        }
    }

    async sendMessage(
        message: IMProtoMessage,
    ): Promise<EncapsulatedIMProtoMessage> {
        const sentMessage = await this.queueMessage(message);
        await this.flushQueue();
        this.logger.debug('> sent ', JSON.stringify(sentMessage));
        return sentMessage;
    }

    private async encapsulateMessage(
        message: IMProtoMessage,
    ): Promise<EncapsulatedIMProtoMessage> {
        const timestamp = new Date().toISOString() as ISO8601;
        const sha256 = await CryptoUtils.singleton.sha256fromObject({
            ...message,
            timestamp,
        });
        return { ...message, sha256, timestamp };
    }

    private async queueEncapsulatedMessage(
        encapsulatedMessage: EncapsulatedIMProtoMessage,
    ) {
        // TODO clear on 'received'
        this.messageQueue.add(encapsulatedMessage);
        await Promise.allSettled(
            this.endpoints.map((endpoint) =>
                endpoint.queue(encapsulatedMessage),
            ),
        );
        this.logger.debug(
            `> queued ${encapsulatedMessage.sha256} (${this.messageQueue.size})`,
        );
    }

    async queueMessage(
        message: IMProtoMessage,
    ): Promise<EncapsulatedIMProtoMessage> {
        const encapsulatedMessage = await this.encapsulateMessage(message);
        await this.queueEncapsulatedMessage(encapsulatedMessage);
        return encapsulatedMessage;
    }

    private readonly mutex = new AsyncLock();
    private retryTimeout?: NodeJS.Timeout;
    async flushQueue(
        attempt: number = 0,
        delay: number = this.INITIAL_RETRY_DELAY_MS,
        recursiveCall: boolean = false,
    ): Promise<void> {
        if (attempt >= this.MAX_RETRY_ATTEMPTS) {
            throw new Error(
                `failed to flush queue after ${attempt} retries (${this.id})`,
            );
        }
        return this.mutex.acquire('flushQueue', async () => {
            if (this.retryTimeout && !recursiveCall) {
                this.logger.debug(
                    'queue is already scheduled for flushing, skipping',
                );
                return;
            }
            try {
                this.logger.debug(
                    `> flushing attempt ${attempt + 1}/${this.MAX_RETRY_ATTEMPTS}`,
                );
                await this.flushEndpoints();
                clearTimeout(this.retryTimeout);
                this.retryTimeout = undefined;
                return;
            } catch {
                const newDelay = Math.min(delay * 2, this.MAX_RETRY_DELAY_MS);
                this.logger.debug(
                    `retry ${attempt + 1}/${this.MAX_RETRY_ATTEMPTS} failed, ` +
                        `retrying in ${newDelay}ms`,
                );
                new Promise<void>((resolve) => {
                    this.retryTimeout = setTimeout(() => {
                        resolve(this.flushQueue(attempt + 1, newDelay, true));
                    }, newDelay);
                }).then();
            }
        });
    }

    // TODO: pick either P2P or all Endpoints
    private async flushEndpoints() {
        this.logger.debug(
            `> flushing current message queue (${this.messageQueue.size}) to ${this.endpoints.length} endpoints`,
        );
        const results = await Promise.allSettled(
            this.endpoints.map((endpoint) => endpoint.flush()),
        );
        const failed = results.find((r) => r.status === 'rejected');
        if (failed) {
            throw new Error('Flush failed for some endpoints');
        }
    }

    async cancelRetry() {
        return this.mutex.acquire('flushQueue', async () => {
            if (this.retryTimeout) {
                clearTimeout(this.retryTimeout);
                this.retryTimeout = undefined;
            }
        });
    }

    // TODO: refresh DID

    private async resetSessions(keepActive: boolean = false) {
        const did = await this.getDID();
        await this.sessionManager.handleSessionReset(did.ik, keepActive);
        await this.configureEndpoints(false);
        await this.flushQueue();
    }

    async triggerSessionReset(): Promise<EncapsulatedIMProtoMessage> {
        this.logger.debug(`Triggering session reset for ${this.id}`);
        await this.resetSessions();
        return this.sendMessage(IM_RESET_SESSION_MESSAGE);
    }

    private readonly alreadyProcessedSessionReset: string[] = [];
    async incomingSessionReset(sha256: string) {
        await this.mutex.acquire('sessionReset', async () => {
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
