import { BaseResolver } from '@src/callbacks/BaseResolver.js';
import { IMProtoMessage } from '@src/types/index.js';

export class NeverResolver extends BaseResolver<IMProtoMessage, never> {
    resolve(): Promise<never> {
        return Promise.resolve(undefined as never);
    }
}
