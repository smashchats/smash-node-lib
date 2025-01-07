export class Timeout {
    private timeout: NodeJS.Timeout | undefined;

    constructor(callback: () => void, delay: number) {
        this.timeout =
            typeof globalThis.setTimeout !== 'undefined'
                ? globalThis.setTimeout(callback, delay)
                : undefined;
    }

    public clear() {
        if (typeof globalThis.clearTimeout !== 'undefined') {
            globalThis.clearTimeout(this.timeout);
        }
    }
}
