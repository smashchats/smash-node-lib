import { IMSessionResetMessage } from './types/improto.lexicon.js';
import {
    SmashChatDiscoverMessage,
    SmashChatJoinMessage,
} from './types/smashchats.lexicon.js';

export const EXPIRATION_TIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const IM_RESET_SESSION_MESSAGE = {
    type: 'org.improto.session.reset',
    data: undefined,
    after: '0',
} as IMSessionResetMessage;

export const SMASH_NBH_JOIN_MESSAGE = {
    type: 'com.smashchats.nbh.join',
    data: undefined,
    after: '0',
} as SmashChatJoinMessage;

export const SMASH_NBH_DISCOVER_MESSAGE = {
    type: 'com.smashchats.nbh.discover',
    data: undefined,
    after: '0',
} as SmashChatDiscoverMessage;
