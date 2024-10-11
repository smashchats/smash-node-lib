import { EncapsulatedSmashMessage } from '@src/types/index.js';

// TODO what if there are multiple unlinked chains? (eg, lost message)
export const sortSmashMessages = (
    messages: EncapsulatedSmashMessage[],
): EncapsulatedSmashMessage[] => {
    const orderedMessages: EncapsulatedSmashMessage[] = [];
    const messageMap = new Map<string, EncapsulatedSmashMessage>();
    messages.forEach((message) => {
        messageMap.set(message.sha1, message);
    });
    const usedMessages = new Set<string>();
    // Arbitrarily start with any message and chain both forward and backward
    messages.forEach((message) => {
        if (usedMessages.has(message.sha1)) return;
        const currentChain = [];
        let currentMessage: EncapsulatedSmashMessage | undefined = message;
        while (currentMessage && !usedMessages.has(currentMessage.sha1)) {
            currentChain.push(currentMessage);
            usedMessages.add(currentMessage.sha1);
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
