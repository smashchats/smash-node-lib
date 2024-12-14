import { EncapsulatedIMProtoMessage } from '@src/types/index.js';

// TODO what if there are multiple unlinked chains? (eg, lost message)
export const sortSmashMessages = (
    messages: EncapsulatedIMProtoMessage[],
): EncapsulatedIMProtoMessage[] => {
    const orderedMessages: EncapsulatedIMProtoMessage[] = [];
    const messageMap = new Map<string, EncapsulatedIMProtoMessage>();
    messages.forEach((message) => {
        messageMap.set(message.sha256, message);
    });
    const usedMessages = new Set<string>();
    // Arbitrarily start with any message and chain both forward and backward
    messages.forEach((message) => {
        if (usedMessages.has(message.sha256)) return;
        const currentChain = [];
        let currentMessage: EncapsulatedIMProtoMessage | undefined = message;
        while (currentMessage && !usedMessages.has(currentMessage.sha256)) {
            currentChain.push(currentMessage);
            usedMessages.add(currentMessage.sha256);
            currentMessage = currentMessage.after
                ? messageMap.get(currentMessage.after)
                : undefined;
        }
        if (currentChain.length > 0) {
            orderedMessages.push(...currentChain.toReversed());
        }
    });

    return orderedMessages;
};

// TODO, how to best export it? Rename?
