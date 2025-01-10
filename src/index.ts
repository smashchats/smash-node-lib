export { SmashMessaging } from '@src/api/SmashMessaging.js';

export { SmashNAB } from '@src/api/role/SmashNAB.js';
export { SmashUser } from '@src/api/role/SmashUser.js';

export { DIDDocManager } from '@src/api/resolvers/DIDDocManager.js';

export { encapsulateMessage } from '@src/api/tools/encapsulateMessage.js';
export { sortSmashMessages } from '@src/api/tools/sortSmashMessages.js';

export { ECPublicKey } from '2key-ratchet';

export * from '@src/shared/utils/Logger.js';

export * from '@src/shared/constants/index.js';
export * from '@src/shared/errors/index.js';
export * from '@src/shared/events/index.js';
export * from '@src/shared/lexicon/index.js';
export * from '@src/shared/types/index.js';

export type { IMPeerIdentity } from '@src/core/identity/IMPeerIdentity.js';
