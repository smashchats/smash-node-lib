import { onMessagesStatusFn } from '@src/types/index.js';
import { Logger } from '@src/utils/index.js';
import { type Socket, io } from 'socket.io-client';
import { clearTimeout, setTimeout } from 'timers';

type SMEAuthParams = {
    key: string;
    keyAlgorithm: KeyAlgorithm;
};

export class SMESocketWriteOnly {
    protected socket?: Socket;

    constructor(
        public readonly url: string,
        private readonly onMessagesStatusCallback: onMessagesStatusFn,
        protected readonly logger: Logger,
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
        buffer: ArrayBuffer,
        messageIds: string[],
    ) {
        if (!messageIds.length) {
            this.logger.warn(`called sendData with no messageIds`);
            return;
        }
        if (!this.socket) {
            this.socket = SMESocketWriteOnly.initSocket(this.logger, this.url);
        }
        this.socket?.emit('data', preKey, sessionId, buffer, () => {
            this.logger.debug(`${messageIds} "delivered"`);
            this.onMessagesStatusCallback(messageIds, 'delivered');
        });
    }

    protected static initSocket(
        logger: Logger,
        url: string,
        auth?: SMEAuthParams,
    ) {
        logger.debug(`SMESocketWriteOnly::initSocket ${url} with auth`);
        const socket = io(url, { auth });
        socket.on('ping', () => {
            logger.debug(`> Ping from SME ${url}`);
        });
        socket.on('connect', () => {
            logger.info(`> Connected to SME ${url}`);
        });
        socket.on('connect_error', (error: Error) => {
            logger.warn(`> Connect error to SME ${url}: ${error}`);
        });
        socket.on('reconnect', () => {
            logger.info(`> Reconnected to SME ${url}`);
        });
        socket.on('reconnect_attempt', (attempt: number) => {
            logger.debug(`> Reconnect attempt ${attempt} to SME ${url}`);
        });
        socket.on('reconnect_error', (error: Error) => {
            logger.warn(`> Reconnect error to SME ${url}: ${error}`);
        });
        socket.on('reconnect_failed', () => {
            logger.error(`> Failed to connect to SME ${url}. Giving up.`);
            // TODO: handle this
        });
        return socket;
    }
}
