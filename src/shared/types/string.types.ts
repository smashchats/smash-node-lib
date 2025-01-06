export type ISO8601 =
    `${number}-${string}-${string}T${string}:${string}:${string}${string}${string}`;
export const reverseDNSRegex =
    /^[a-zA-Z0-9]+\.[a-zA-Z0-9]+\.[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*$/;
export type reverseDNS = `${string}.${string}.${string}`;
export type sha256 = `${string & { length: 64 }}`;
export type undefinedString = '' | '0';
