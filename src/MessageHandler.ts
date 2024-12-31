import { Logger } from './utils/Logger.js';

export class MessageHandler {
    constructor(private readonly logger: Logger) {}

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
}
