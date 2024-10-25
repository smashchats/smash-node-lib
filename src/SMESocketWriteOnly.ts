import { Logger } from '@src/Logger.js';
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
        protected logger: Logger,
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
            this.socket = SMESocketWriteOnly.initSocket(this.logger, this.url);
        }
        this.socket.emit('data', preKey, sessionId, buffer, () => {
            this.logger.debug(`${messageIds} "delivered"`);
            this.onMessagesStatusCallback(messageIds, 'delivered');
        });
    }

    protected static initSocket(
        logger: Logger,
        url: string,
        auth?: SMEAuthParams,
    ) {
        const socket = io(url, { auth });
        socket.on('connect', () => {
            logger.info(`> Connected to SME ${url}`);
        });
        return socket;
    }
}
