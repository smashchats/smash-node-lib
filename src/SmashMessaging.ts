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
    type MessageStatus,
    type sha256,
} from '@src/types/index.js';
import type { LogLevel } from '@src/utils/index.js';
import { Logger } from '@src/utils/index.js';
import { EventEmitter } from 'events';

// interface SmashChat {
//     with: DID;
//     lastMessageTimestamp: string;
// }

type ProfileMeta = Omit<IMProfile, 'did'>;

// class PreferredEndpointHandler extends BaseResolver<
//     IMSessionEndpointMessage,
//     void
// > {
//     resolve(peer: SmashPeer, message: IMSessionEndpointMessage): Promise<void> {
//         peer.setPreferredEndpoint(message.data);
//         return Promise.resolve();
//     }
// }

// class SessionResetHandler extends BaseResolver<IMSessionResetMessage, void> {
//     resolve(peer: SmashPeer, message: IMSessionResetMessage): Promise<void> {
//         return peer.incomingSessionReset(message.sha256!);
//     }
// }

// TODO: safeguard crypto operations against errors
// TODO: split beteen IMProto and Smash Messaging
export class SmashMessaging extends EventEmitter {
    private static didDocManagers: Map<DIDMethod, DIDManager> = new Map();
    public static use(method: DIDMethod, manager: DIDManager) {
        this.didDocManagers.set(method, manager);
    }
    public static resolve(did: DID) {
        const didString = typeof did === 'string' ? did : did.id;
        const method = DIDManager.parseMethod(didString);
        const resolver = this.didDocManagers.get(method);
        if (!resolver) throw new Error(`No resolver found for ${didString}`);
        return resolver.resolve(didString);
    }

    protected readonly logger: Logger;

    public readonly endpoints: EndpointManager;
    protected readonly peers: PeerRegistry;
    private readonly sessionManager: SessionManager;
    private readonly smeSocketManager: SMESocketManager;
    private meta: Partial<ProfileMeta> = {};

    constructor(
        protected readonly identity: IMPeerIdentity,
        LOG_ID: string = 'SmashMessaging',
        LOG_LEVEL: LogLevel = 'INFO',
    ) {
        super();
        this.logger = new Logger(LOG_ID, LOG_LEVEL);
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
            identity,
            this.logger,
            messageMiddleware,
        );
        this.endpoints = new EndpointManager(
            this.logger,
            this.identity,
            this.smeSocketManager,
            this.sessionManager,
        );
        this.registerAckHandlers();
        this.logger.info(
            `Loaded Smash lib (log level: ${LOG_LEVEL}, id: ${LOG_ID})`,
        );
    }

    static setCrypto(c: globalThis.Crypto) {
        CryptoManager.setCrypto(c);
    }

    private async createNewPeer(peerDid: DID, lastMessageTime: number) {
        return new SmashPeer(
            this.logger,
            peerDid,
            lastMessageTime,
            this.sessionManager,
            this.smeSocketManager,
        );
    }

    async close() {
        const peersToClose = Array.from(this.peers.values());
        this.logger.debug(`>> closing (${peersToClose.length}) peers`);
        const peersResult = await Promise.allSettled(
            peersToClose.map((p) => p.cancelRetry()),
        );
        this.logger.debug(`>> closing (${this.endpoints.size}) endpoints`);
        const socketsResult = await this.smeSocketManager.closeAllSockets();
        this.endpoints.reset([]);
        const failedToClosePeers = peersResult.filter(
            (r) => r.status === 'rejected',
        );
        const failedToCloseSockets = socketsResult.filter(
            (r) => r.status === 'rejected',
        );
        if (failedToClosePeers.length || failedToCloseSockets.length) {
            if (failedToClosePeers.length) {
                this.logger.warn(
                    `<< some peers failed to close: ${failedToClosePeers.map((r) => r.reason).join(', ')}`,
                );
            }
            if (failedToCloseSockets.length) {
                this.logger.warn(
                    `<< some sockets failed to close: ${failedToCloseSockets.map((r) => r.reason).join(', ')}`,
                );
            }
        } else {
            this.logger.info('<<< CLOSED');
        }
    }

    // async initChats(chats: SmashChat[]) {
    //     return Promise.all(
    //         chats.map(async (chat) => {
    //             const peerDid = await DIDResolver.resolve(chat.with);
    //             this.peers[peerDid.id] = await this.getOrCreatePeer(
    //                 peerDid,
    //                 chat.lastMessageTimestamp,
    //             );
    //         }),
    //     );
    // }

    /**
     * Firehose incoming events to the library user
     */
    private async notifyNewMessages(
        sender: DIDString,
        messages: EncapsulatedIMProtoMessage[],
    ) {
        if (!messages?.length) return;
        this.logger.debug(`notifyNewMessages (${messages?.length})`);
        this.logger.debug(JSON.stringify(messages, null, 2));
        messages.forEach((message) =>
            this.emit(message.type, sender, message, this.peers.get(sender)),
        );
        messages.forEach((message) => this.emit('data', sender, message));
    }

    private registerAckHandlers() {
        const handleAck = (
            status: MessageStatus,
            from: DIDString,
            messageIds: sha256[],
        ) => {
            this.messagesStatusHandler(status, messageIds);
            this.peers
                .get(from)
                ?.ack(messageIds)
                .then(() => {
                    this.logger.debug(
                        `> cleared ${messageIds} from sending queues`,
                    );
                });
        };

        this.on(IM_ACK_RECEIVED, (from, message) => {
            handleAck('received', from, message.data);
        });

        this.on(IM_ACK_READ, (from, message) => {
            handleAck('read', from, message.data);
        });
    }

    private messagesStatusHandler(status: MessageStatus, messageIds: sha256[]) {
        this.logger.debug(
            `messagesStatusHandler ACK:${status} : ${messageIds.join(', ')}`,
        );
        this.emit('status', status, messageIds);
    }

    public async ackMessagesRead(did: DID, messageIds: sha256[]) {
        return this.send(did, {
            type: IM_ACK_READ,
            data: messageIds,
        } as IMReadACKMessage);
    }

    async send(peerDid: DID, message: IMProtoMessage) {
        const peer = await this.peers.getOrCreate(peerDid);
        return peer.send(message);
    }

    async getDIDDocument(): Promise<DIDDocument> {
        return this.identity.getDIDDocument();
    }

    get did(): DIDString {
        return this.identity.did;
    }

    get profile(): IMProfile {
        return {
            ...{
                title: '',
                description: '',
                avatar: '',
            },
            ...this.meta,
            did: this.did,
        };
    }

    async updateMeta(meta?: Partial<ProfileMeta>) {
        this.meta = meta || {};
        await this.peers.updateUserProfile(this.profile);
    }

    on<T extends string>(
        eventName: T,
        listener: (...args: EventArgs<T>) => void,
    ): this {
        return super.on(eventName, listener);
    }

    emit<T extends string>(eventName: T, ...args: EventArgs<T>): boolean {
        return super.emit(eventName, ...args);
    }

    // TODO demo usage in test suite
    static handleError(
        reason: unknown,
        promise: Promise<unknown>,
        logger: Logger,
    ) {
        if (
            typeof reason === 'object' &&
            reason !== null &&
            'name' in reason &&
            reason.name === 'OperationError'
        ) {
            logger.warn(
                '[SmashMessaging] Decryption OperationError: Possible key mismatch or corrupted data.',
            );
            logger.debug(
                'Detailed cause:',
                (reason as { cause?: string }).cause ||
                    'No additional error cause found',
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
