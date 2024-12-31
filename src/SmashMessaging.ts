import { EndpointManager } from '@src/EndpointManager.js';
import { IMPeerIdentity } from '@src/IMPeerIdentity.js';
import { MessageMiddleware } from '@src/MessageMiddleware.js';
import { PeerRegistry } from '@src/PeerRegistry.js';
import { SmashPeer } from '@src/SmashPeer.js';
import { CryptoManager } from '@src/crypto/utils/CryptoManager.js';
import { DIDManager } from '@src/did/DIDManager.js';
import { SessionManager } from '@src/signal/SessionManager.js';
import { SMESocketManager } from '@src/sme/SMESocketManager.js';
import type {
    DID,
    DIDDocument,
    DIDMethod,
    DIDString,
    EncapsulatedIMProtoMessage,
    IMProfile,
    IMProtoMessage,
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
    private readonly peers: PeerRegistry;
    private readonly sessionManager: SessionManager;
    private readonly smeSocketManager: SMESocketManager;
    private meta: Partial<ProfileMeta> = {};

    constructor(
        private readonly identity: IMPeerIdentity,
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
        // this.superRegister(IM_PROFILE, new DataForwardingResolver(IM_PROFILE));
        // this.superRegister(
        //     IM_SESSION_RESET,
        //     new SessionResetHandler(IM_SESSION_RESET),
        // );
        // this.superRegister(
        //     IM_SESSION_ENDPOINT,
        //     new PreferredEndpointHandler(IM_SESSION_ENDPOINT),
        // );
        // this.superRegister(
        //     IM_ACK_RECEIVED,
        //     new DataForwardingResolver(IM_ACK_RECEIVED),
        // );
        // this.on(IM_ACK_RECEIVED, (from: DIDString, messageIds: sha256[]) => {
        //     this.logger.debug(`>> Received ACK for ${messageIds} from ${from}`);
        //     this.emit('status', 'received', messageIds);
        //     this.peers[from]?.ack(messageIds).then(() => {
        //         this.logger.debug(
        //             `> cleared ${messageIds} from sending queues`,
        //         );
        //     });
        // });
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

    // // async initChats(chats: SmashChat[]) {
    // //     return Promise.all(
    // //         chats.map(async (chat) => {
    // //             const peerDid = await DIDResolver.resolve(chat.with);
    // //             this.peers[peerDid.id] = await this.getOrCreatePeer(
    // //                 peerDid,
    // //                 chat.lastMessageTimestamp,
    // //             );
    // //         }),
    // //     );
    // // }

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
        messages.forEach((message) => this.emit('data', sender, message));
    }

    private async messagesStatusHandler(status: string, messageIds: string[]) {
        this.logger.debug(`messagesStatusHandler "${status}" : ${messageIds}`);
        this.emit('status', status, messageIds);
    }

    // private async incomingMessageParser(
    //     peer: SmashPeer,
    //     message: EncapsulatedIMProtoMessage,
    // ) {
    //     const handlers = this.messageHandlers.get(message.type);
    //     if (!handlers?.length) return;
    //     await Promise.allSettled(
    //         handlers.map(({ eventName, resolver }) =>
    //             resolver
    //                 .resolve(peer, message)
    //                 .then((result) =>
    //                     this.emit(
    //                         eventName,
    //                         peer.id,
    //                         result,
    //                         message.sha256,
    //                         message.timestamp,
    //                     ),
    //                 ),
    //         ),
    //     );
    // }

    // private async incomingMessagesParser(
    //     peer: SmashPeer,
    //     messages: EncapsulatedIMProtoMessage[],
    // ) {
    //     await Promise.allSettled(
    //         messages.map((message) =>
    //             this.incomingMessageParser(peer, message),
    //         ),
    //     );
    // }

    // private readonly messageHandlers: Map<
    //     string,
    //     {
    //         eventName: string;
    //         resolver: BaseResolver<IMProtoMessage, unknown>;
    //     }[]
    // > = new Map();

    // /**
    //  * Register a resolver for a specific message type
    //  * @param eventName Event name triggered by the library
    //  * @param resolver Resolver instance that extends BaseResolver
    //  * @typeparam T Type of messages to resolve
    //  */
    // public register(
    //     eventName: `data.${string}`,
    //     resolver: BaseResolver<IMProtoMessage, unknown>,
    // ): void {
    //     this.superRegister(eventName, resolver);
    // }
    // protected superRegister(
    //     eventName: string,
    //     resolver: BaseResolver<IMProtoMessage, unknown>,
    // ): void {
    //     const messageType = resolver.getMessageType();
    //     if (!this.messageHandlers.has(messageType)) {
    //         this.messageHandlers.set(messageType, []);
    //     }
    //     this.messageHandlers.get(messageType)!.push({ eventName, resolver });
    // }

    // /**
    //  * Unregister a specific resolver for a message type
    //  * @param eventName Event name to unregister
    //  * @param resolver Resolver instance to unregister
    //  */
    // public unregister(
    //     eventName: string,
    //     resolver: BaseResolver<IMProtoMessage, unknown>,
    // ): void {
    //     const messageType = resolver.getMessageType();
    //     const handlers = this.messageHandlers.get(messageType);
    //     if (!handlers) return;
    //     const filteredHandlers = handlers.filter(
    //         (handler) =>
    //             handler.eventName !== eventName ||
    //             handler.resolver !== resolver,
    //     );
    //     if (filteredHandlers.length === 0) {
    //         this.messageHandlers.delete(messageType);
    //     } else {
    //         this.messageHandlers.set(messageType, filteredHandlers);
    //     }
    // }

    // sendTextMessage(
    //     peerDid: DID,
    //     text: string,
    //     after: string,
    // ): Promise<EncapsulatedIMProtoMessage> {
    //     return this.sendMessage(peerDid, {
    //         type: IM_CHAT_TEXT,
    //         data: text,
    //         after,
    //     } as IMTextMessage);
    // }

    async send(peerDid: DID, message: IMProtoMessage) {
        const peer = await this.peers.getOrCreate(peerDid);
        return peer.send(message);
    }

    async getDID(): Promise<DIDDocument> {
        return this.identity.getDID();
    }

    get did(): DIDString {
        return this.identity.did;
    }

    // TODO: get DID from separate system message
    getProfile(): IMProfile {
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

    async updateMeta(meta: ProfileMeta) {
        this.meta = meta;
        await this.peers.updateUserProfile(this.getProfile());
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
