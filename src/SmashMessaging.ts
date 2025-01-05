import { EndpointManager } from '@src/EndpointManager.js';
import { IMPeerIdentity } from '@src/IMPeerIdentity.js';
import { MessageMiddleware } from '@src/MessageMiddleware.js';
import { PeerRegistry } from '@src/PeerRegistry.js';
import { SmashPeer } from '@src/SmashPeer.js';
import { CryptoManager } from '@src/crypto/utils/CryptoManager.js';
import { DIDManager } from '@src/did/DIDManager.js';
import { SessionManager } from '@src/signal/SessionManager.js';
import { SMESocketManager } from '@src/sme/SMESocketManager.js';
import { EventArgs } from '@src/types/events.js';
import {
    type DID,
    type DIDDocument,
    type DIDMethod,
    type DIDString,
    type EncapsulatedIMProtoMessage,
    type IMProfile,
    type IMProtoMessage,
    IMReadACKMessage,
    IM_ACK_READ,
    IM_ACK_RECEIVED,
    IM_SESSION_ENDPOINT,
    IM_SESSION_RESET,
    type MessageStatus,
    reverseDNSRegex,
    type sha256,
} from '@src/types/index.js';
import type { LogLevel } from '@src/utils/index.js';
import { Logger } from '@src/utils/index.js';
import { EventEmitter } from 'events';

interface SmashChat {
    with: DID;
    lastMessageTimestamp: string;
}

type ProfileMeta = Omit<IMProfile, 'did'>;

// TODO: safeguard crypto operations against errors
// TODO: split beteen IMProto and Smash Messaging

export class SmashMessaging extends EventEmitter {
    protected static readonly didDocManagers = new Map<DIDMethod, DIDManager>();
    protected readonly logger: Logger;
    public readonly endpoints: EndpointManager;
    protected readonly peers: PeerRegistry;
    private readonly sessionManager: SessionManager;
    private readonly smeSocketManager: SMESocketManager;
    private meta: Partial<ProfileMeta> = {};

    constructor(
        protected readonly identity: IMPeerIdentity,
        logId: string = 'SmashMessaging',
        logLevel: LogLevel = 'INFO',
    ) {
        super();
        this.logger = new Logger(logId, logLevel);
        this.smeSocketManager = new SMESocketManager(
            this.logger,
            this.messagesStatusHandler.bind(this),
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
        this.registerEventHandlers();
        this.logger.info(
            `SmashMessaging (log level: ${logLevel}, id: ${logId}, did: ${this.identity.did})`,
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

    public static use(method: DIDMethod, manager: DIDManager): void {
        this.didDocManagers.set(method, manager);
    }

    public static resolve(did: DID): Promise<DIDDocument> {
        const didString = typeof did === 'string' ? did : did.id;
        const method = DIDManager.parseMethod(didString);
        const resolver = this.didDocManagers.get(method);

        if (!resolver) {
            throw new Error(`No resolver found for ${didString}`);
        }

        return resolver.resolve(didString);
    }

    public static setCrypto(c: globalThis.Crypto): void {
        CryptoManager.setCrypto(c);
    }

    public static async importIdentity(json: string): Promise<IMPeerIdentity> {
        return IMPeerIdentity.deserialize(json);
    }

    public static handleError(
        reason: unknown,
        promise: Promise<unknown>,
        logger: Logger,
    ): void {
        if (isOperationError(reason)) {
            logger.warn(
                '[SmashMessaging] Decryption OperationError: Possible key mismatch or corrupted data.',
            );
            logger.debug(
                'Detailed cause:',
                (reason as { cause?: string }).cause ||
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
            this.peers,
        );
    }

    private async notifyNewMessages(
        sender: DIDString,
        messages: EncapsulatedIMProtoMessage[],
    ): Promise<void> {
        if (!messages?.length) return;

        this.logger.debug(`notifyNewMessages (${messages?.length})`);
        this.logger.debug(JSON.stringify(messages, null, 2));

        messages.forEach((message) => {
            if (reverseDNSRegex.test(message.type)) {
                this.emit(message.type, sender, message);
            } else {
                this.logger.warn(
                    `Invalid message type format received: ${message.type}`,
                );
            }
            this.emit('data', sender, message);
        });
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
            handleAck('received', from, message.data);
        });

        this.on(IM_ACK_READ, (from, message) => {
            handleAck('read', from, message.data);
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
    }

    public async close(): Promise<void> {
        // WARNING: destructive action!!
        this.removeAllListeners();
        // Cancelling peer message queues
        this.logger.debug(`>> closing (${this.peers.size}) peers`);
        const peersResult = await this.peers.closeAll();
        // Closing all network sockets
        this.logger.debug(`>> closing all sockets`);
        const socketsResult = await this.smeSocketManager.closeAllSockets();
        this.endpoints.reset([]);
        // Handling close results
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

    public async initChats(chats: SmashChat[]): Promise<void> {
        const results = await Promise.allSettled(
            chats.map(async (chat) =>
                this.peers.getOrCreate(chat.with, chat.lastMessageTimestamp),
            ),
        );
        const failures = results.filter((r) => r.status === 'rejected');
        if (failures.length > 0) {
            this.logger.warn(
                `Failed to initialize ${failures.length} chats: ${failures
                    .map((f) => (f as PromiseRejectedResult).reason)
                    .join(', ')}`,
            );
        }
    }

    public async ackMessagesRead(
        did: DID,
        messageIds: sha256[],
    ): Promise<EncapsulatedIMProtoMessage> {
        return this.send(did, {
            type: IM_ACK_READ,
            data: messageIds,
        } as IMReadACKMessage);
    }

    public async send(
        peerDid: DID,
        message: IMProtoMessage,
    ): Promise<EncapsulatedIMProtoMessage> {
        const peer = await this.peers.getOrCreate(peerDid);
        return peer.send(message);
    }

    // TODO: serialize using DID standard format W3C (including when private keys are present!!!)
    public async exportIdentity(): Promise<string> {
        this.logger.warn('EXPORTED IDENTITY CONTAINS SECRETS: DO NOT SHARE!');
        return this.identity.serialize();
    }

    public async getDIDDocument(): Promise<DIDDocument> {
        return this.identity.getDIDDocument();
    }

    public async updateMeta(meta?: Partial<ProfileMeta>): Promise<void> {
        this.meta = meta || {};
        await this.peers.updateUserProfile(this.profile);
    }

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

    public on<T extends string>(
        eventName: T,
        listener: (...args: EventArgs<T>) => void,
    ): this {
        return super.on(eventName, listener);
    }

    public once<T extends string>(
        eventName: T,
        listener: (...args: EventArgs<T>) => void,
    ): this {
        return super.once(eventName, listener);
    }

    public emit<T extends string>(
        eventName: T,
        ...args: EventArgs<T>
    ): boolean {
        return super.emit(eventName, ...args);
    }
}

function isOperationError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'OperationError'
    );
}
