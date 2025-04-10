export const EXPIRATION_TIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const SESSION_TTL_MS = EXPIRATION_TIME_MS;
// MAX_MESSAGE_SIZE set to 512KB to match socket.io cap
// https://socket.io/fr/how-to/upload-a-file
// Note that files shouldnt be sent as Smash messages, but with CDN protocols
export const MAX_MESSAGE_SIZE = 512 * 1024;
