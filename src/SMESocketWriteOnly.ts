import { Socket, io } from 'socket.io-client';

type SMEAuthParams = {
    key: string;
    keyAlgorithm: KeyAlgorithm;
};

export type onMessagesStatusFn = (ids: string[], status: string) => any;

export class SMESocketWriteOnly {
    protected socket?: Socket;

    constructor(
        public readonly url: string,
        private onMessagesStatusCallback: onMessagesStatusFn,
    ) {}

    async close(TIMEOUT_MS = 3000): Promise<void> {
        if (this.socket)
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(
                        new Error(
                            `Timeout exceeded while closing socket (${TIMEOUT_MS}ms)`,
                        ),
                    );
                }, TIMEOUT_MS);
                this.socket?.on('disconnect', () => {
                    clearTimeout(timeout);
                    resolve();
                });
                this.socket?.disconnect();
            });
        else return Promise.resolve();
    }

    public sendData(
        preKey: string,
        sessionId: string,
        buffer: Buffer,
        messageIds: string[],
    ) {
        if (!this.socket) {
            this.socket = SMESocketWriteOnly.initSocket(this.url);
        }
        this.socket.emit('data', preKey, sessionId, buffer, () => {
            console.debug(`${messageIds} "delivered"`);
            this.onMessagesStatusCallback(messageIds, 'delivered');
        });
    }

    protected static initSocket(url: string, auth?: SMEAuthParams) {
        const socket = io(url, { auth });
        socket.on('connect', () => {
            console.log(`> Connected to SME ${url}`);
        });
        return socket;
    }
}
