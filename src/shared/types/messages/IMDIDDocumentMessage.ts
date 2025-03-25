import { IM_DID_DOCUMENT } from '@src/shared/lexicon/improto.lexicon.js';
import { DIDDocument } from '@src/shared/types/did.types.js';
import { IMProtoMessage } from '@src/shared/types/message.types.js';

/**
 * DID document message
 *
 * Used to trustfully share the fully-resolved DID document from peer to peer.
 */
export interface IMDIDDocumentMessage extends IMProtoMessage {
    type: typeof IM_DID_DOCUMENT;
    data: DIDDocument;
}
