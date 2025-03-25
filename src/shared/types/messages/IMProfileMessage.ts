import { IM_PROFILE } from '@src/shared/lexicon/improto.lexicon.js';
import { DID } from '@src/shared/types/did.types.js';
import { IMProtoMessage } from '@src/shared/types/message.types.js';

export interface IMProfile {
    version?: 1;
    did: DID;
    title: string;
    description: string;
    avatar: string;
}

/**
 * Profile message
 *
 * Used to send one's Profile to a peer.
 */
export interface IMProfileMessage extends IMProtoMessage {
    type: typeof IM_PROFILE;
    data: IMProfile;
}
