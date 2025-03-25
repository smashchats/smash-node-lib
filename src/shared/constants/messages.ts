import { IM_SESSION_RESET } from '@src/shared/lexicon/improto.lexicon.js';
import {
    SMASH_NBH_DISCOVER,
    SMASH_NBH_JOIN,
    type SmashChatDiscoverMessage,
    type SmashChatJoinMessage,
} from '@src/shared/lexicon/smashchats.lexicon.js';

import { IMSessionResetMessage } from '../types/messages/index.js';

export const IM_RESET_SESSION_MESSAGE = {
    type: IM_SESSION_RESET,
    data: undefined,
    after: '0',
} as IMSessionResetMessage;

export const SMASH_NBH_JOIN_MESSAGE = {
    type: SMASH_NBH_JOIN,
    data: undefined,
    after: '0',
} as SmashChatJoinMessage;

export const SMASH_NBH_DISCOVER_MESSAGE = {
    type: SMASH_NBH_DISCOVER,
    data: undefined,
    after: '0',
} as SmashChatDiscoverMessage;
