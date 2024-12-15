import { SmashPeer } from '@src/SmashPeer.js';
import { IMProtoMessage } from '@src/types/index.js';

export abstract class BaseResolver<T extends IMProtoMessage, R> {
    abstract resolve(peer: SmashPeer, message: T): Promise<R>;

    constructor(
        protected readonly messageType: T['type'] & string,
        protected readonly version: string = '1.0.0',
    ) {}

    getMessageType(): string {
        return this.messageType;
    }
}
