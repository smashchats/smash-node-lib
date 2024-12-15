import { SmashPeer } from '@src/SmashPeer.js';
import { BaseResolver } from '@src/callbacks/BaseResolver.js';
import { DIDDocument, IMProtoMessage } from '@src/types/index.js';

export class SenderDIDDocumentResolver<
    T extends IMProtoMessage,
> extends BaseResolver<T, DIDDocument> {
    resolve(peer: SmashPeer): Promise<DIDDocument> {
        return peer.getDID();
    }
}
