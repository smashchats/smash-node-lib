import { BaseResolver } from '@src/callbacks/BaseResolver.js';
import { IMProtoMessage } from '@src/types/index.js';

export class NeverResolver<T extends IMProtoMessage> extends BaseResolver<
    T,
    never
> {
    resolve(): Promise<never> {
        return Promise.resolve(undefined as never);
    }
}
