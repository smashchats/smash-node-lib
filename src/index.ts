export * from '@src/types/index.js';

// Import and re-export classes and functions
export { default as SmashMessaging } from '@src/SmashMessaging.js';
export { default as SmashNAB } from '@src/SmashNAB.js';
export { default as SmashUser } from '@src/SmashUser.js';
export { SMESocketManager } from '@src/SMESocketManager.js';
export { SMESocketReadWrite } from '@src/SMESocketReadWrite.js';
export { SMESocketWriteOnly } from '@src/SMESocketWriteOnly.js';
export { SessionManager } from '@src/SessionManager.js';
export { SignalSession } from '@src/SignalSession.js';
export { SmashPeer } from '@src/SmashPeer.js';
export { sortSmashMessages } from '@src/SmashTools.js';
export { ECPublicKey } from '2key-ratchet';

// Logging setup (you might want to move this to a separate file)
type LogLevel = 'DEBUG' | 'LOG' | 'WARN' | 'ERROR';
const LOG_LEVEL = 'DEBUG' as LogLevel;

switch (LOG_LEVEL) {
    case 'ERROR':
        console.warn = () => {};
    // eslint-disable-next-line no-fallthrough
    case 'WARN':
        console.log = () => {};
    // eslint-disable-next-line no-fallthrough
    case 'LOG':
        console.debug = () => {};
}
