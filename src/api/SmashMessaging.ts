import { encapsulateMessage } from '@src/api/tools/encapsulateMessage.js';
import type { IRestrictedCryptoEngine } from '@src/core/crypto/engine/CryptoEngine.js';
import { CryptoManager } from '@src/core/crypto/engine/CryptoManager.js';
import { IMPeerIdentity } from '@src/core/identity/IMPeerIdentity.js';
import { DIDManager } from '@src/core/identity/did/DIDManager.js';
import { PeerRegistry } from '@src/core/messaging/peer/PeerRegistry.js';
import { SmashPeer } from '@src/core/messaging/peer/SmashPeer.js';
import { MessageMiddleware } from '@src/core/messaging/protocol/MessageMiddleware.js';
import { MessageReassembler } from '@src/core/messaging/protocol/MessageReassembler.js';
import { MessageSplitter } from '@src/core/messaging/protocol/MessageSplitter.js';
import { SessionManager } from '@src/core/messaging/session/SessionManager.js';
import { EndpointManager } from '@src/infrastructure/network/endpoints/EndpointManager.js';
import { SMESocketManager } from '@src/infrastructure/network/sme/SMESocketManager.js';
import { OperationError } from '@src/shared/errors/OperationError.js';
import type { EventArgs } from '@src/shared/events/EventArgs.js';
import type { MessagingEventMap } from '@src/shared/events/MessagingEventMap.js';
import {
    IM_ACK_READ,
    IM_ACK_RECEIVED,
    IM_PART,
    IM_SESSION_ENDPOINT,
    IM_SESSION_RESET,
} from '@src/shared/lexicon/improto.lexicon.js';
import type {
    DID,
    DIDDocument,
    DIDString,
    EncapsulatedIMProtoMessage,
    IDIDResolver,
    IIMPeerIdentity,
    IMProtoMessage,
    IMReceivedACKMessage,
    reverseDNS,
    sha256,
} from '@src/shared/types/index.js';
import type { IMPartData } from '@src/shared/types/messages/IMPartMessage.js';
import {
    IMProfile,
    IMReadACKMessage,
    MessageStatus,
    MessageStatusDelivered,
    MessageStatusRead,
    MessageStatusReceived,
} from '@src/shared/types/messages/index.js';
import { LogLevel, Logger } from '@src/shared/utils/Logger.js';
import { EventEmitter } from 'events';

/**
 * Main public API for the Smash Protocol
 * @public
 */
export class SmashMessaging extends EventEmitter {
    public readonly endpoints: EndpointManager;
    protected readonly logger: Logger;
    protected readonly peers: PeerRegistry;
    private readonly sessionManager: SessionManager;
    private readonly smeSocketManager: SMESocketManager;
    private readonly messageSplitter: MessageSplitter;
    private readonly messageReassembler: MessageReassembler;
    private meta: Partial<IMProfile> = {};

    /**
     * Create a new SmashMessaging instance to start using the Smash Protocol
     * @param identity - The identity (ie, DID document with private keys) to use for the messaging instance
     * @param logId - The ID to use for logging (default: 'SmashMessaging')
     * @param logLevel - The log level to use for logging (default: 'INFO')
     */
    constructor(
        protected readonly identity: IMPeerIdentity,
        logId: string = 'SmashMessaging',
        logLevel: LogLevel = 'INFO',
    ) {
        super();
        this.logger = new Logger(logId, logLevel);
        const messageStatusHandler = this.messagesStatusHandler.bind(this);

        this.smeSocketManager = new SMESocketManager(
            this.logger,
            messageStatusHandler,
        );

        this.peers = new PeerRegistry(
            this.logger,
            this.createNewPeer.bind(this),
        );

        const messageMiddleware = new MessageMiddleware(
            this.logger,
            this.peers,
            this.notifyNewMessages.bind(this),
        );

        this.sessionManager = new SessionManager(
            this.identity,
            this.logger,
            messageMiddleware,
        );

        this.endpoints = new EndpointManager(
            this.logger,
            this.identity,
            this.smeSocketManager,
            this.sessionManager,
        );

        this.messageReassembler = new MessageReassembler(this.logger);
        this.messageSplitter = new MessageSplitter(
            this.logger,
            messageStatusHandler,
        );

        this.registerEventHandlers();
        this.logger.info(
            `SmashMessaging (log level: ${logLevel}, id: ${logId}, did: ${this.identity.did})`,
        );
    }

    /**
     * Register a DID method implementation using a resolver
     * @param resolver - The resolver to register
     */
    public static use(resolver: IDIDResolver): void {
        DIDManager.use(resolver.method, resolver);
    }

    /**
     * Resolve a DID to its DID Document using the registered resolver (if any)
     * @param did - The DID to resolve
     * @returns The resolved DID Document
     * @throws Error if no resolver is found for the DID method or if fails to resolve the DID
     */
    public static resolve(did: DID): Promise<DIDDocument> {
        return DIDManager.resolve(did);
    }

    /**
     * Set the crypto implementation to use for the underlying library
     */
    public static setCrypto(c: IRestrictedCryptoEngine): void {
        CryptoManager.setCrypto(c);
    }

    /**
     * Import an identity from serialized form
     * @param serialized - The serialized identity string
     * @returns The imported identity
     */
    public static async importIdentity(
        ...params: Parameters<typeof IMPeerIdentity.deserialize>
    ): Promise<IMPeerIdentity> {
        return IMPeerIdentity.deserialize(...params);
    }

    /**
     * Handle operational errors
     * OperationErrors can happen if the underlying crypto library fails to decrypt a message
     * These shouldnt crash the program, but should be logged as warnings
     * TODO: Add a way to handle these errors in a more graceful way
     */
    public static handleError(
        reason: unknown,
        promise: Promise<unknown>,
        logger: Logger,
    ): void {
        if (OperationError.isOperationError(reason)) {
            logger.warn(
                '[SmashMessaging] Decryption OperationError: Possible key mismatch or corrupted data.',
            );
            logger.debug(
                'Detailed cause:',
                (reason as { cause?: string }).cause ??
                    'No additional error cause found',
            );
            return;
        }
        logger.error(
            '[SmashMessaging] Unhandled rejection at:',
            promise,
            'reason:',
            reason,
        );
    }

    private registerEventHandlers(): void {
        this.registerAckHandlers();
        this.registerSessionHandlers();
    }

    private registerSessionHandlers(): void {
        this.on(IM_SESSION_ENDPOINT, (did, message) => {
            return this.peers.get(did)?.setPreferredEndpoint(message.data);
        });

        this.on(IM_SESSION_RESET, (did, message) => {
            return this.peers.get(did)?.incomingSessionReset(message.sha256!);
        });
    }

    private async createNewPeer(
        peerDid: DID,
        lastMessageTime: number,
    ): Promise<SmashPeer> {
        return new SmashPeer(
            this.logger,
            peerDid,
            lastMessageTime,
            this.sessionManager,
            this.smeSocketManager,
            this.messageSplitter,
            this.peers,
        );
    }

    private async notifyNewMessage(
        sender: DIDString,
        message: EncapsulatedIMProtoMessage,
    ): Promise<void> {
        this.logger.debug(
            `notifyNewMessage (${message.type}) for sender ${sender}`,
        );
        this.logger.debug(message);
        if (this.isValidMessageType(message.type)) {
            this.logger.debug(
                `Emitting message of type ${message.type} for sender ${sender}`,
            );
            this.emit(message.type, sender, message);
        } else {
            this.logger.warn(
                `Invalid message type format received: ${message.type} from sender ${sender}`,
            );
        }
        this.logger.debug(
            `Emitting 'data' event for message ${message.sha256} from sender ${sender}`,
        );
        this.emit('data', sender, message);
    }

    private async notifyNewMessages(
        sender: DIDString,
        messages: EncapsulatedIMProtoMessage[],
    ): Promise<void> {
        if (!messages?.length) {
            this.logger.debug('No messages to notify');
            return;
        }
        this.logger.debug(
            `Processing ${messages.length} new messages from sender ${sender}`,
        );

        for (const message of messages) {
            this.logger.debug(
                `Processing message ${message.sha256} of type ${message.type}`,
            );

            if (message.type === IM_PART) {
                this.logger.debug(
                    `Received part message ${message.sha256} for original message ${(message.data as IMPartData).originalSha256}`,
                );
                this.logger.debug(message);

                const reassembledMessage =
                    this.messageReassembler.addPart(message);
                if (reassembledMessage) {
                    this.logger.info(
                        `Successfully reassembled message ${reassembledMessage.sha256} from parts`,
                    );
                    await this.notifyNewMessage(sender, reassembledMessage);
                    (await this.peers.getOrCreate(sender)).send(
                        await encapsulateMessage({
                            type: IM_ACK_RECEIVED,
                            data: [reassembledMessage.sha256],
                        } as IMReceivedACKMessage),
                    );
                } else {
                    this.logger.debug(
                        `Waiting for more parts for message ${(message.data as IMPartData).originalSha256}`,
                    );
                }
            } else {
                await this.notifyNewMessage(sender, message);
            }
        }
    }

    private isValidMessageType(type: string): boolean {
        return /^[a-z]+(\.[a-z]+)*$/.test(type);
    }

    private registerAckHandlers(): void {
        const handleAck = async (
            status: MessageStatus,
            from: DIDString,
            messageIds: sha256[],
        ) => {
            this.messagesStatusHandler(status, messageIds);
            const peer = this.peers.get(from);
            if (peer) {
                await peer.ack(messageIds);
                this.logger.debug(
                    `> cleared ${messageIds} from sending queues`,
                );
            }
        };

        this.on(IM_ACK_RECEIVED, (from, message) => {
            handleAck(MessageStatusReceived, from, message.data);
        });

        this.on(IM_ACK_READ, (from, message) => {
            handleAck(MessageStatusRead, from, message.data);
        });
    }

    private messagesStatusHandler(
        status: MessageStatus,
        messageIds: sha256[],
    ): void {
        this.logger.debug(
            `messagesStatusHandler ACK:${status} : ${messageIds.join(', ')}`,
        );
        this.emit('status', status, messageIds);
        if (status === MessageStatusDelivered) {
            this.messageSplitter.markAsDelivered(messageIds);
        }
    }

    /**
     * Initialize chats with peers
     */
    public async initChats(
        chats: { with: DID; lastMessageTimestamp: string }[],
    ): Promise<void> {
        const results = await Promise.allSettled(
            chats.map(async (chat) =>
                this.peers.getOrCreate(chat.with, chat.lastMessageTimestamp),
            ),
        );
        const failures = results.filter((r) => r.status === 'rejected');
        if (failures.length > 0) {
            this.logger.warn(
                `Failed to initialize ${failures.length} chats: ${failures
                    .map((f) => f.reason)
                    .join(', ')}`,
            );
        }
    }

    /**
     * Send a message to a peer
     * @param peerDid - The DID of the peer to send the message to (DID url or Document)
     * @param message - The message to send (already encapsulated or not)
     * @returns The encapsulated message that has been scheduled for sending
     */
    public async send(
        peerDid: DID,
        message: IMProtoMessage | EncapsulatedIMProtoMessage,
    ): Promise<EncapsulatedIMProtoMessage> {
        const peer = await this.peers.getOrCreate(peerDid);
        const encapsulatedMessage =
            'sha256' in message
                ? (message as EncapsulatedIMProtoMessage)
                : await encapsulateMessage(message);
        await peer.send(encapsulatedMessage);
        return encapsulatedMessage;
    }

    /**
     * Acknowledge messages as read
     */
    public async ackMessagesRead(
        did: DID,
        messageIds: sha256[],
    ): Promise<EncapsulatedIMProtoMessage> {
        return this.send(did, {
            type: IM_ACK_READ,
            data: messageIds,
        } as IMReadACKMessage);
    }

    /**
     * Export identity (warning: contains secrets)
     */
    public async exportIdentity(): Promise<IIMPeerIdentity> {
        this.logger.warn('EXPORTED IDENTITY CONTAINS SECRETS: DO NOT SHARE!');
        return this.identity.serialize();
    }

    /**
     * Get DID Document
     */
    public async getDIDDocument(): Promise<DIDDocument> {
        return this.identity.getDIDDocument();
    }

    /**
     * Update profile metadata
     */
    public async updateMeta(meta?: Partial<IMProfile>): Promise<void> {
        this.meta = meta || {};
        await this.peers.updateUserProfile(this.profile);
    }

    /**
     * Close all connections and clean up
     */
    public async close(): Promise<void> {
        this.removeAllListeners();
        const peersResult = await this.peers.closeAll();
        const socketsResult = await this.smeSocketManager.closeAllSockets();
        this.endpoints.reset([]);
        this.handleCloseResults(peersResult, socketsResult);
    }

    private handleCloseResults(
        peersResult: PromiseSettledResult<unknown>[],
        socketsResult: PromiseSettledResult<unknown>[],
    ): void {
        const failedToClosePeers = peersResult.filter(
            (r) => r.status === 'rejected',
        );
        const failedToCloseSockets = socketsResult.filter(
            (r) => r.status === 'rejected',
        );

        if (failedToClosePeers.length || failedToCloseSockets.length) {
            this.logCloseFailures(failedToClosePeers, failedToCloseSockets);
        } else {
            this.logger.info('<<< CLOSED');
        }
    }

    private logCloseFailures(
        failedPeers: PromiseRejectedResult[],
        failedSockets: PromiseRejectedResult[],
    ): void {
        if (failedPeers.length) {
            this.logger.warn(
                `<< some peers failed to close: ${failedPeers.map((r) => r.reason).join(', ')}`,
            );
        }
        if (failedSockets.length) {
            this.logger.warn(
                `<< some sockets failed to close: ${failedSockets.map((r) => r.reason).join(', ')}`,
            );
        }
    }

    // Public getters
    public get did(): DIDString {
        return this.identity.did;
    }

    public get profile(): IMProfile {
        return {
            title: '',
            description: '',
            avatar: '',
            ...this.meta,
            did: this.did,
        };
    }

    // Event emitter type-safe overrides
    public on<T extends reverseDNS | keyof MessagingEventMap>(
        eventName: T,
        listener: (...args: EventArgs<T>) => void,
    ): this {
        return super.on(eventName, listener);
    }

    public once<T extends reverseDNS | keyof MessagingEventMap>(
        eventName: T,
        listener: (...args: EventArgs<T>) => void,
    ): this {
        return super.once(eventName, listener);
    }

    public emit<T extends reverseDNS | keyof MessagingEventMap>(
        eventName: T,
        ...args: EventArgs<T>
    ): boolean {
        return super.emit(eventName, ...args);
    }
}
