import { SmashMessaging } from '@src/SmashMessaging.js';
import { IM_RESET_SESSION_MESSAGE } from '@src/const.js';
import { SessionManager, SignalSession } from '@src/signal/index.js';
import { SMESocketManager, SmashPeerEndpoint } from '@src/sme/index.js';
import {
    DID,
    DIDDocument,
    DIDString,
    EncapsulatedIMProtoMessage,
    IMProtoMessage,
    Relationship,
    SMASH_NBH_RELATIONSHIP,
    SmashEndpoint,
    sha256,
} from '@src/types/index.js';
import { Logger } from '@src/utils/Logger.js';
import { CryptoUtils } from '@src/utils/index.js';
import AsyncLock from 'async-lock';

export class SmashPeer {
    // TODO: default to use 'id' everywhere document is not needed
    public readonly id: DIDString;
    // TODO subscribe on changes like updates to DID, IK, EK, PK...
    private endpoints: SmashPeerEndpoint[] = [];

    private readonly messageQueue: Map<sha256, EncapsulatedIMProtoMessage> =
        new Map();
    private readonly MAX_RETRY_ATTEMPTS = 10;
    private readonly INITIAL_RETRY_DELAY_MS = 1000;
    private readonly MAX_RETRY_DELAY_MS = 600000; // 10 minutes
    private readonly mutex = new AsyncLock();

    constructor(
        private readonly logger: Logger,
        private readonly did: DID,
        private readonly lastMessageTime: number,
        private readonly sessionManager: SessionManager,
        private readonly smeSocketManager: SMESocketManager,
    ) {
        this.id = typeof did === 'string' ? did : did.id;
    }

    getDID(): Promise<DIDDocument> {
        return SmashMessaging.resolve(this.did);
    }

    // TODO allow loading relationship at lib initialization time
    private relationship: Relationship = 'clear';
    private lastRelationshipSha256: sha256 | undefined;

    async setRelationship(relationship: Relationship, nabs: SmashPeer[]) {
        if (this.relationship === relationship) {
            return;
        }
        // ASSUMPTION#4: for now, we assume we only have one NAB to update
        const nab = nabs[0];
        const updateNabMessage = await nab.send({
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

    async configureEndpoints(): Promise<void> {
        return this.mutex.acquire(`configureEndpoints-${this.id}`, async () => {
            const did = await this.getDID();
            this.logger.debug(
                `SmashPeer::configureEndpoints for peer ${this.id} (${did.endpoints.length})`,
            );
            // if last message is before session TTL,
            // then we need to send a session reset message
            // to let the other peer know that our sessions have been renewed earlier than expected
            if (
                Date.now() - this.lastMessageTime <
                SignalSession.SESSION_TTL_MS
            ) {
                await this.triggerSessionResetByUser();
            }
            // then we can (re)configure endpoints
            this.endpoints = did.endpoints.map(
                (endpointConfig) =>
                    new SmashPeerEndpoint(
                        this.logger,
                        this.smeSocketManager,
                        this.initNewSession.bind(this),
                        endpointConfig,
                        this.messageQueue,
                    ),
            );
            // flush message queues in the background on (re)-configure
            this.flushQueue().then();
        });
    }

    private async initNewSession(endpointConfig: SmashEndpoint) {
        return this.sessionManager.initSession(
            await this.getDID(),
            endpointConfig,
        );
    }

    async send(
        message: IMProtoMessage | EncapsulatedIMProtoMessage,
    ): Promise<EncapsulatedIMProtoMessage> {
        const encapsulatedMessage =
            'sha256' in message
                ? (message as EncapsulatedIMProtoMessage)
                : await this.encapsulateMessage(message);
        await this.sendEncapsulatedMessage(encapsulatedMessage);
        return encapsulatedMessage;
    }

    private async encapsulateMessage(
        message: IMProtoMessage,
    ): Promise<EncapsulatedIMProtoMessage> {
        return CryptoUtils.singleton.encapsulateMessage(message);
    }

    private async sendEncapsulatedMessage(
        encapsulatedMessage: EncapsulatedIMProtoMessage,
    ) {
        this.logger.debug('> sending ', JSON.stringify(encapsulatedMessage));
        await this.queueMessage(encapsulatedMessage);
        await this.flushQueue();
    }

    async queueMessage(encapsulatedMessage: EncapsulatedIMProtoMessage) {
        // mutex: wait dont queue and flush the same queues at the same time
        return this.mutex.acquire(`flushQueue-${this.id}`, async () => {
            await this.queueAllEndpoints(encapsulatedMessage);
        });
    }

    // TODO: pick either P2P or all Endpoints
    async flush() {
        // mutex: wait for preferred endpoint to be set before flushing
        return this.mutex.acquire(`preferredEndpoint-${this.id}`, async () => {
            const session = this.sessionManager.getPreferredForPeerIk(
                (await this.getDID()).ik,
            );
            if (session && this.preferredEndpoint) {
                this.logger.debug(
                    `> flushing current message queue (${this.messageQueue.size}) to preferred endpoint ${this.preferredEndpoint.config.url}`,
                );
                await this.preferredEndpoint.flush(session);
            } else {
                await this.flushAllEndpoints();
            }
        });
    }

    private async queueAllEndpoints(
        encapsulatedMessage: EncapsulatedIMProtoMessage,
    ) {
        this.messageQueue.set(encapsulatedMessage.sha256, encapsulatedMessage);
        await Promise.allSettled(
            this.endpoints.map((endpoint) =>
                endpoint.queue(encapsulatedMessage),
            ),
        );
        this.logger.debug(
            `> queued ${encapsulatedMessage.sha256} (${this.messageQueue.size})`,
        );
    }

    async ack(messageIds: sha256[]) {
        // mutex: wait dont clear and flush the same queues at the same time
        return this.mutex.acquire(`flushQueue-${this.id}`, async () => {
            messageIds.forEach((messageId) => {
                this.messageQueue.delete(messageId);
            });
            await Promise.allSettled(
                this.endpoints.map((endpoint) => endpoint.ack(messageIds)),
            );
        });
    }

    private retryTimeout?: NodeJS.Timeout;
    private async flushQueue(
        attempt: number = 0,
        delay: number = this.INITIAL_RETRY_DELAY_MS,
        recursiveCall: boolean = false,
    ): Promise<void> {
        if (attempt >= this.MAX_RETRY_ATTEMPTS) {
            throw new Error(`failed to flush queue after ${attempt} retries`);
        }
        // mutex: wait dont flush the same peer queue multiple times
        return this.mutex.acquire(
            `flushQueue-${this.id}`,
            async () => {
                if (this.messageQueue.size === 0) {
                    this.logger.debug(
                        `message queue is empty, skipping flushQueue`,
                    );
                    return;
                }
                if (this.retryTimeout && !recursiveCall) {
                    this.logger.debug(
                        'queue is already scheduled for flushing, skipping',
                    );
                } else {
                    await this.attemptFlushOrRetry(attempt, delay);
                }
            },
            { maxOccupationTime: 4000 },
        );
    }

    private async attemptFlushOrRetry(attempt: number, delay: number) {
        try {
            this.logger.debug(
                `> flushing attempt ${attempt + 1}/${this.MAX_RETRY_ATTEMPTS}`,
            );
            await this.flush();
            this.clearRetryTimeout();
        } catch {
            // FAILURE, exponential backoff
            const newDelay = Math.min(delay * 2, this.MAX_RETRY_DELAY_MS);
            this.logger.debug(
                `retry ${attempt + 1}/${this.MAX_RETRY_ATTEMPTS} failed, ` +
                    `retrying in ${newDelay}ms`,
            );
            this.sessionManager.resetPreferredSession((await this.getDID()).ik);
            await this.scheduleFlushQueue(attempt + 1, newDelay);
        }
    }

    private async scheduleFlushQueue(attempt: number, delay: number) {
        if (typeof globalThis.setTimeout !== 'undefined') {
            this.retryTimeout = globalThis.setTimeout(
                () => this.flushQueue(attempt, delay, true),
                delay,
            );
        } else {
            this.logger.warn(
                'setTimeout not available: skipping flush queue scheduling.',
            );
        }
    }

    private preferredEndpoint: SmashPeerEndpoint | undefined;
    setPreferredEndpoint(endpoint: SmashEndpoint): Promise<void> {
        // mutex: prevent flushing while changing preferred endpoint
        return this.mutex.acquire(`preferredEndpoint-${this.id}`, () => {
            // TODO: if doesnt exist, create it
            this.preferredEndpoint = this.endpoints.find(
                (e) =>
                    e.config.url === endpoint.url &&
                    e.config.preKey === endpoint.preKey,
            );
            this.logger.debug(
                `> setPreferredEndpoint for ${this.id} to ${this.preferredEndpoint?.config.url}`,
            );
        });
    }

    private async flushAllEndpoints() {
        this.logger.debug(
            `> flushing current message queue (${this.messageQueue.size}) to ${this.endpoints.length} endpoints`,
        );
        const results = await Promise.allSettled(
            this.endpoints.map((endpoint) => endpoint.flush(undefined)),
        );
        const failed = results.find((r) => r.status === 'rejected');
        if (failed) {
            throw new Error('Flush failed for some endpoints');
        }
    }

    async cancelRetry() {
        this.logger.debug(`SmashPeer::cancelRetry for peer ${this.id}`);
        // mutex: wait for flushqueue before clearing retries
        return this.mutex.acquire(
            `flushQueue-${this.id}`,
            () => {
                this.logger.debug(
                    `SmashPeer::cancelRetry: acquired (${this.retryTimeout})`,
                );
                this.clearRetryTimeout();
            },
            { skipQueue: true, timeout: 3000 },
        );
    }

    private clearRetryTimeout() {
        if (typeof globalThis.clearTimeout !== 'undefined') {
            globalThis.clearTimeout(this.retryTimeout);
        }
        this.retryTimeout = undefined;
    }

    private async resetSessions(deleteActiveSession: boolean = false) {
        this.endpoints.forEach((endpoint) => endpoint.resetSession());
        this.sessionManager.removeAllSessionsForPeerIK(
            (await this.getDID()).ik,
            deleteActiveSession,
        );
    }

    private async triggerSessionResetByUser() {
        this.logger.debug(`Triggering session reset for ${this.id}`);
        const deleteActiveSession = true;
        await this.resetSessions(deleteActiveSession);
        const encapsulatedMessage = await this.encapsulateMessage(
            IM_RESET_SESSION_MESSAGE,
        );
        await this.queueMessage(encapsulatedMessage);
    }

    private readonly alreadyProcessedSessionReset: string[] = [];
    async incomingSessionReset(sha256: string) {
        // mutex to cover for potential parallel calls of this method by the same peer
        await this.mutex.acquire(`sessionReset-${this.id}`, async () => {
            if (this.alreadyProcessedSessionReset.includes(sha256)) {
                this.logger.debug(
                    `> Already processed session reset ${sha256}, skipping`,
                );
                return;
            }
            this.logger.debug(`<<< Processing session reset ${sha256} >>>`);
            await this.resetSessions();
            this.alreadyProcessedSessionReset.push(sha256);
        });
    }
}
