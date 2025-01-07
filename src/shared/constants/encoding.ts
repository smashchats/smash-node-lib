// base64 vs base64url?
// base64url is the same as base64 but without the padding and with a few characters replaced
// to avoid problems with special characters in URLs.
export const ENCODING = 'base64' as const;
