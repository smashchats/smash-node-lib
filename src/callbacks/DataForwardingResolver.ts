import { SmashPeer } from '@src/SmashPeer.js';
import { BaseResolver } from '@src/callbacks/BaseResolver.js';
import { IMProtoMessage } from '@src/types/index.js';

export class DataForwardingResolver<
    T extends IMProtoMessage,
> extends BaseResolver<T, T['data']> {
    resolve(_: SmashPeer, message: T): Promise<T['data']> {
        return Promise.resolve(message.data);
    }
}
