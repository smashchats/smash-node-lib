import { encapsulateMessage } from '@src/api/tools/encapsulateMessage.js';
import { DIDManager } from '@src/core/identity/did/DIDManager.js';
import type { PeerRegistry } from '@src/core/messaging/peer/PeerRegistry.js';
import { SmashPeerEndpoint } from '@src/core/messaging/peer/SmashPeerEndpoint.js';
import type { SessionManager } from '@src/core/messaging/session/SessionManager.js';
import { SignalSession } from '@src/core/messaging/session/SignalSession.js';
import type { SMESocketManager } from '@src/infrastructure/network/sme/SMESocketManager.js';
import { IM_RESET_SESSION_MESSAGE } from '@src/shared/constants/messages.js';
import type { Relationship } from '@src/shared/lexicon/smashchats.lexicon.js';
import { SMASH_NBH_RELATIONSHIP } from '@src/shared/lexicon/smashchats.lexicon.js';
import type {
    DID,
    DIDDocument,
    DIDString,
} from '@src/shared/types/did.types.js';
import type {
    EncapsulatedIMProtoMessage,
    IMProtoMessage,
} from '@src/shared/types/message.types.js';
import type { SmashEndpoint } from '@src/shared/types/sme.types.js';
import type {
    sha256,
    undefinedString,
} from '@src/shared/types/string.types.js';
import type { Logger } from '@src/shared/utils/Logger.js';
import AsyncLock from 'async-lock';

interface PeerConfig {
    maxRetryAttempts?: number;
    initialRetryDelayMs?: number;
    maxRetryDelayMs?: number;
}

export class SmashPeer {
    public readonly id: DIDString;
    private readonly endpoints: SmashPeerEndpoint[] = [];
    private readonly messageQueue = new Map<
        sha256,
        EncapsulatedIMProtoMessage
    >();
    private readonly mutex = new AsyncLock();
    private readonly config: Required<PeerConfig>;
    private preferredEndpoint?: SmashPeerEndpoint;
    private retryTimeout?: NodeJS.Timeout;
    private closed = false;
    private relationship: Relationship = 'clear';
    private lastRelationshipSha256: sha256 | undefinedString = '';
    private readonly alreadyProcessedSessionReset: string[] = [];

    constructor(
        private readonly logger: Logger,
        private readonly did: DID,
        private readonly lastMessageTime: number,
        private readonly sessionManager: SessionManager,
        private readonly smeSocketManager: SMESocketManager,
        private readonly peerRegistry: PeerRegistry,
        config: PeerConfig = {},
    ) {
        this.id = typeof did === 'string' ? did : did.id;
        this.config = {
            maxRetryAttempts: config.maxRetryAttempts ?? 10,
            initialRetryDelayMs: config.initialRetryDelayMs ?? 1000,
            maxRetryDelayMs: config.maxRetryDelayMs ?? 600000, // 10 minutes
        };
    }

    async getDIDDocument(): Promise<DIDDocument> {
        return DIDManager.resolve(this.did);
    }

    async setRelationship(relationship: Relationship, nabs: SmashPeer[]) {
        if (this.relationship === relationship) return;

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
            const did = await this.getDIDDocument();
            this.logger.debug(
                `SmashPeer::configureEndpoints for peer ${this.id} (${did.endpoints.length})`,
            );
            // if last message is before session TTL,
            // then we need to send a session reset message
            // to let the other peer know that our sessions have been renewed earlier than expected
            const needsSessionReset =
                Date.now() - this.lastMessageTime <
                SignalSession.SESSION_TTL_MS;
            if (needsSessionReset) {
                await this.triggerSessionResetByUser();
            }
            // then we can (re)configure endpoints
            this.endpoints.length = 0; // Clear existing endpoints
            did.endpoints.forEach((config) => {
                this.endpoints.push(
                    new SmashPeerEndpoint(
                        this.logger,
                        this,
                        this.smeSocketManager,
                        this.sessionManager,
                        config,
                        this.messageQueue,
                    ),
                );
            });

            // Flush message queues in background
            void this.flushQueue();
        });
    }

    async send(
        message: IMProtoMessage | EncapsulatedIMProtoMessage,
    ): Promise<EncapsulatedIMProtoMessage> {
        const encapsulatedMessage =
            'sha256' in message
                ? (message as EncapsulatedIMProtoMessage)
                : await encapsulateMessage(message);

        await this.queueMessage(encapsulatedMessage);
        await this.flushQueue();
        return encapsulatedMessage;
    }

    async queueMessage(message: EncapsulatedIMProtoMessage) {
        return this.mutex.acquire(`flushQueue-${this.id}`, async () => {
            this.messageQueue.set(message.sha256, message);
            await Promise.allSettled(
                this.endpoints.map((endpoint) => endpoint.queue(message)),
            );
            this.logger.debug(
                `> queued ${message.sha256} (${this.messageQueue.size}) for all endpoints (${this.endpoints.length})`,
            );
        });
    }

    async ack(messageIds: sha256[]) {
        return this.mutex.acquire(`flushQueue-${this.id}`, async () => {
            messageIds.forEach((id) => this.messageQueue.delete(id));
            await Promise.allSettled(
                this.endpoints.map((endpoint) => endpoint.ack(messageIds)),
            );
        });
    }

    private async flushQueue(
        attempt = 0,
        delay = this.config.initialRetryDelayMs,
        recursiveCall = false,
    ): Promise<void> {
        if (attempt >= this.config.maxRetryAttempts) {
            throw new Error(`Failed to flush queue after ${attempt} retries`);
        }

        return this.mutex.acquire(
            `flushQueue-${this.id}`,
            async () => {
                if (this.messageQueue.size === 0) {
                    this.logger.debug(
                        'Message queue is empty, skipping flushQueue',
                    );
                    return;
                }

                if (this.retryTimeout && !recursiveCall) {
                    this.logger.debug(
                        'Queue is already scheduled for flushing, skipping',
                    );
                    return;
                }

                await this.attemptFlushOrRetry(attempt, delay);
            },
            { maxOccupationTime: 20000 },
        );
    }

    private async attemptFlushOrRetry(attempt: number, delay: number) {
        if (this.closed) {
            this.logger.debug(
                `Skipping flush ${attempt + 1} attempt - peer is closed`,
            );
            return;
        }

        try {
            this.logger.debug(
                `> Flushing attempt ${attempt + 1}/${this.config.maxRetryAttempts}`,
            );
            await this.flush();
            this.clearRetryTimeout();
        } catch (err) {
            if (this.closed) {
                this.logger.debug('Skipping retry - peer is closed');
                return;
            }

            const newDelay = Math.min(delay * 2, this.config.maxRetryDelayMs);
            this.logger.debug(
                `Retry ${attempt + 1}/${this.config.maxRetryAttempts} failed (${(err as Error).message}), ` +
                    `retrying in ${newDelay}ms`,
            );

            const did = await this.getDIDDocument();
            this.sessionManager.resetPreferredSession(did.ik);
            await this.scheduleFlushQueue(attempt + 1, newDelay);
        }
    }

    private async scheduleFlushQueue(
        attempt: number,
        delay: number,
    ): Promise<void> {
        const peerId = this.id;
        this.clearRetryTimeout();
        if (this.closed) {
            this.logger.debug('Skipping scheduling flush - peer is closed');
            return;
        }
        this.retryTimeout =
            typeof globalThis.setTimeout !== 'undefined'
                ? globalThis.setTimeout(async () => {
                      // Get the canonical instance when the timeout fires
                      const peer = this.peerRegistry.get(peerId);
                      if (!peer || peer.closed) {
                          this.logger.debug(
                              'Skipping scheduled flush - peer was closed or disposed',
                          );
                          return;
                      }
                      await peer.flushQueue(attempt, delay, true);
                  }, delay)
                : undefined;
    }

    setPreferredEndpoint(endpoint: SmashEndpoint): Promise<void> {
        return this.mutex.acquire(`preferredEndpoint-${this.id}`, () => {
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

    private async flush() {
        return this.mutex.acquire(`preferredEndpoint-${this.id}`, async () => {
            const did = await this.getDIDDocument();
            const session = this.sessionManager.getPreferredForPeerIk(did.ik);

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

    private async flushAllEndpoints() {
        this.logger.debug(
            `> flushing current message queue (${this.messageQueue.size}) to ${this.endpoints.length} endpoints`,
        );

        const results = await Promise.allSettled(
            this.endpoints.map((endpoint) => endpoint.flush(undefined)),
        );

        const failures = results.filter(
            (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        if (failures.length > 0) {
            const failureReasons = failures
                .map((f) => f.reason?.message || 'Unknown error')
                .join('; ');
            throw new Error(
                `Flush failed for ${failures.length} endpoint(s): ${failureReasons}`,
            );
        }
    }

    async close() {
        this.logger.debug(`Closing peer ${this.id}`);
        this.closed = true;
        this.messageQueue.clear();
        await this.cancelRetry();
        await Promise.allSettled(
            this.endpoints.map((endpoint) => endpoint.clearQueue()),
        );
        this.logger.debug(`Closed peer ${this.id} (${this.closed})`);
    }

    private async cancelRetry() {
        this.logger.debug(`SmashPeer::cancelRetry for peer ${this.id}`);
        await this.mutex.acquire(
            `flushQueue-${this.id}`,
            async () => {
                this.logger.debug(
                    `SmashPeer::cancelRetry: acquired (${this.retryTimeout})`,
                );
                this.clearRetryTimeout();
                await Promise.allSettled(
                    this.endpoints.map((endpoint) => endpoint.waitForQueue()),
                );
            },
            { skipQueue: true, timeout: 10000 },
        );
    }

    private clearRetryTimeout() {
        this.logger.debug(
            `SmashPeer::clearRetryTimeout ${this.retryTimeout} for peer ${this.id}`,
        );
        if (typeof globalThis.clearTimeout !== 'undefined') {
            globalThis.clearTimeout(this.retryTimeout);
        }
        this.retryTimeout = undefined;
    }

    private async resetSessions(deleteActiveSession = false) {
        this.endpoints.forEach((endpoint) => endpoint.resetSession());
        const did = await this.getDIDDocument();
        this.sessionManager.removeAllSessionsForPeerIK(
            did.ik,
            deleteActiveSession,
        );
    }

    private async triggerSessionResetByUser() {
        this.logger.debug(`Triggering session reset for ${this.id}`);
        await this.resetSessions(true);
        const message = await encapsulateMessage(IM_RESET_SESSION_MESSAGE);
        await this.queueMessage(message);
    }

    async incomingSessionReset(sha256: string) {
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
