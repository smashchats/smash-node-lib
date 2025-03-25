import {
    IM_SESSION_ENDPOINT,
    IM_SESSION_RESET,
} from '@src/shared/lexicon/improto.lexicon.js';
import { IMProtoMessage } from '@src/shared/types/message.types.js';
import { SmashEndpoint } from '@src/shared/types/sme.types.js';

/**
 * Session Reset message
 *
 * Used to request a peer to reset all sessions with them.
 */
export interface IMSessionResetMessage extends IMProtoMessage {
    type: typeof IM_SESSION_RESET;
    data: never;
}

/**
 * Session Endpoint message
 *
 * Used to request a peer to reset all sessions with them.
 */
export interface IMSessionEndpointMessage extends IMProtoMessage {
    type: typeof IM_SESSION_ENDPOINT;
    data: SmashEndpoint;
}
