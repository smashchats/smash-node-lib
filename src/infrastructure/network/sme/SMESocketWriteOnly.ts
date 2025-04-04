import type { onMessagesStatusFn } from '@src/shared/types/callbacks.types.js';
import type { sha256 } from '@src/shared/types/string.types.js';
import type { Logger } from '@src/shared/utils/Logger.js';
import { Timeout } from '@src/shared/utils/Timeout.js';
import { type Socket, io } from 'socket.io-client';

type SMEAuthParams = {
    key: string;
    keyAlgorithm: KeyAlgorithm;
};

export class SMESocketWriteOnly {
    protected socket?: Socket;

    constructor(
        protected readonly logger: Logger,
        public readonly url: string,
        private readonly onMessagesStatusCallback: onMessagesStatusFn,
    ) {}

    async close(TIMEOUT_MS = 5000): Promise<void> {
        if (!this.socket) {
            return;
        }

        return new Promise((resolve) => {
            this.logger.debug(
                `> Disconnecting from SME ${this.url} [${this.socket?.id}]`,
            );

            const timeout = this.createCloseTimeout(TIMEOUT_MS, resolve);

            if (this.socket?.connected) {
                this.handleConnectedClose(timeout, resolve);
            } else {
                this.handleDisconnectedClose(timeout, resolve);
            }
        });
    }

    private createCloseTimeout(timeoutMs: number, resolve: () => void) {
        return new Timeout(() => {
            this.logger.warn(
                `Timeout exceeded while closing socket (${timeoutMs}ms), forcing cleanup [${this.socket?.id}]`,
            );
            this.forceCleanup();
            resolve();
        }, timeoutMs);
    }

    private handleConnectedClose(timeout: Timeout, resolve: () => void) {
        this.socket!.once('disconnect', () => {
            this.logger.info(
                `> Disconnected from SME ${this.url} [${this.socket?.id}]`,
            );
            timeout.clear();
            this.forceCleanup();
            resolve();
        });
        this.socket!.disconnect();
    }

    private handleDisconnectedClose(timeout: Timeout, resolve: () => void) {
        this.forceCleanup();
        timeout.clear();
        resolve();
    }

    private forceCleanup() {
        if (!this.socket) {
            return;
        }
        this.logger.debug(
            `> socket cleanup (${this.url})... [${this.socket?.id}]`,
        );
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket.close();
        this.socket = undefined;
    }

    public sendData(
        preKey: string,
        sessionId: string,
        buffer: ArrayBuffer,
        messageIds: sha256[],
        TIMEOUT_MS: number = 10000,
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!messageIds.length) {
                this.logger.warn(
                    `Called sendData with no messageIds [${this.socket?.id}]`,
                );
                return resolve();
            }

            if (!this.ensureSocketConnection()) {
                return reject(
                    new Error(`Failed to connect to SME ${this.url}`),
                );
            }

            this.sendWithTimeout(
                preKey,
                sessionId,
                buffer,
                messageIds,
                TIMEOUT_MS,
            )
                .then(resolve)
                .catch(reject);
        });
    }

    private ensureSocketConnection(): boolean {
        if (this.socket?.connected) {
            return true;
        }
        this.logger.info(
            `Creating write-only socket for ${this.url} [prev: ${this.socket?.id}]`,
        );
        this.initSocket();
        return !!this.socket;
    }

    private sendWithTimeout(
        preKey: string,
        sessionId: string,
        buffer: ArrayBuffer,
        messageIds: sha256[],
        TIMEOUT_MS: number,
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.logger.debug(
                `> sending ${buffer.byteLength} bytes (${messageIds.length} messages) to ${this.url} [${this.socket?.id}]`,
            );

            const timeout = new Timeout(() => {
                reject(
                    new Error(
                        `Timeout exceeded while sending data to ${this.url} [${this.socket?.id}]`,
                    ),
                );
            }, TIMEOUT_MS);

            this.socket!.emit('data', preKey, sessionId, buffer, () => {
                timeout.clear();
                this.logger.debug(
                    `> ${buffer.byteLength} bytes (${messageIds.length} messages) sent to ${this.url} [${this.socket?.id}]`,
                );
                this.onMessagesStatusCallback('delivered', messageIds);
                resolve();
            });
        });
    }

    protected initSocket(auth?: SMEAuthParams) {
        this.logger.debug(
            `SMESocketWriteOnly::initSocket ${this.url} ${auth ? 'with auth' : 'without auth'}`,
        );

        if (this.socket) {
            this.forceCleanup();
        }

        const socket = this.createSocket(auth);
        this.setupSocketEventHandlers(socket);
        this.socket = socket;
    }

    private createSocket(auth?: SMEAuthParams): Socket {
        return io(this.url, {
            auth,
            transports: ['websocket', 'polling', 'webtransport'],
            // TODO: test reconnection/transport failure scenarios
            reconnection: true,
            reconnectionAttempts: 20,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 30000,
            ackTimeout: 10000,
            retries: 20,
        });
    }

    private setupSocketEventHandlers(socket: Socket) {
        socket.on('connect', () => this.handleConnect(socket));
        socket.on('connect_error', (error: Error) =>
            this.handleConnectError(socket, error),
        );
        socket.on('reconnect', () => this.handleReconnect(socket));
        socket.on('reconnect_attempt', (attempt: number) =>
            this.handleReconnectAttempt(socket, attempt),
        );
        socket.on('reconnect_error', (error: Error) =>
            this.handleReconnectError(socket, error),
        );
        socket.on('reconnect_failed', () => this.handleReconnectFailed(socket));
    }

    private handleConnect(socket: Socket) {
        const transport = socket.io.engine.transport.name;
        this.logger.info(
            `> Connected to SME ${this.url} (${transport}) [${socket.id}]`,
        );

        this.logConnectionState(socket);
        this.setupUpgradeHandler(socket);
    }

    private logConnectionState(socket: Socket) {
        this.logger.debug(
            'Socket connection state:',
            JSON.stringify({
                id: socket.id,
                connected: socket.connected,
                disconnected: socket.disconnected,
                transport: socket.io.engine.transport.name,
                readyState: socket.io.engine.readyState,
            }),
        );
    }

    private setupUpgradeHandler(socket: Socket) {
        socket.io.engine.on('upgrade', () => {
            const upgradedTransport = socket.io.engine.transport.name;
            this.logger.info(
                `> Upgraded connection to SME ${this.url} (${upgradedTransport}) [${socket.id}]`,
            );
            this.logger.debug('Socket post-upgrade state:', {
                id: socket.id,
                transport: upgradedTransport,
                readyState: socket.io.engine.readyState,
            });
        });
    }

    private handleConnectError(socket: Socket, error: Error) {
        this.logger.warn(
            `> Connect error to SME ${this.url}: ${error} [${socket.id}]`,
        );
    }

    private handleReconnect(socket: Socket) {
        this.logger.info(`> Reconnected to SME ${this.url} [${socket.id}]`);
    }

    private handleReconnectAttempt(socket: Socket, attempt: number) {
        this.logger.debug(
            `> Reconnect attempt ${attempt} to SME ${this.url} [${socket.id}]`,
        );
    }

    private handleReconnectError(socket: Socket, error: Error) {
        this.logger.warn(
            `> Reconnect error to SME ${this.url}: ${error} [${socket.id}]`,
        );
    }

    private handleReconnectFailed(socket: Socket) {
        this.logger.error(
            `> Failed to connect to SME ${this.url}. Giving up. [${socket.id}]`,
        );
        this.forceCleanup();
    }
}
