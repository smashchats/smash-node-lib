import { onMessagesStatusFn, sha256 } from '@src/types/index.js';
import { Logger } from '@src/utils/index.js';
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
        return new Promise((resolve) => {
            this.logger.debug(
                `> Disconnecting from SME ${this.url} [${this.socket?.id}]`,
            );
            if (!this.socket) {
                return resolve();
            }
            const socket = this.socket;
            const timeout =
                typeof globalThis.setTimeout !== 'undefined'
                    ? globalThis.setTimeout(() => {
                          this.logger.warn(
                              `Timeout exceeded while closing socket (${TIMEOUT_MS}ms), forcing cleanup [${this.socket?.id}]`,
                          );
                          this.forceCleanup();
                          resolve();
                      }, TIMEOUT_MS)
                    : undefined;
            if (socket.connected) {
                socket.once('disconnect', () => {
                    this.logger.info(
                        `> Disconnected from SME ${this.url} [${this.socket?.id}]`,
                    );
                    if (typeof globalThis.clearTimeout !== 'undefined') {
                        globalThis.clearTimeout(timeout);
                    }
                    this.forceCleanup();
                    resolve();
                });
                socket.disconnect();
            } else {
                this.forceCleanup();
                if (typeof globalThis.clearTimeout !== 'undefined') {
                    globalThis.clearTimeout(timeout);
                }
                resolve();
            }
        });
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
        // if (this.socket.io?.engine) {
        //     this.socket.io.engine.removeAllListeners();
        //     this.socket.io.engine.close();
        //     this.socket.io.engine.transport?.close();
        // }
        this.socket = undefined;
    }

    // TODO: do we want to use simpler ID than preKey? (eg, sha256 of the prekey?)
    /**
     * @param preKey - The recipient's prekey to use as their ID on the SME.
     * @param sessionId - The session ID to use to deliver the message.
     * @param buffer - The data to send.
     * @param messageIds - The corresponding sent message IDs to track.
     */
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
            // || this.socket.io?.engine?.readyState !== 'open'
            if (!this.socket || !this.socket.connected) {
                this.logger.info(
                    `Creating write-only socket for ${this.url} [prev: ${this.socket?.id}]`,
                );
                this.initSocket();
                if (!this.socket) {
                    return reject(
                        new Error(`Failed to connect to SME ${this.url}`),
                    );
                }
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

            const timeout =
                typeof globalThis.setTimeout !== 'undefined'
                    ? globalThis.setTimeout(() => {
                          reject(
                              new Error(
                                  `Timeout exceeded while sending data to ${this.url} [${this.socket?.id}]`,
                              ),
                          );
                      }, TIMEOUT_MS)
                    : undefined;

            this.socket!.emit('data', preKey, sessionId, buffer, () => {
                if (typeof globalThis.clearTimeout !== 'undefined') {
                    globalThis.clearTimeout(timeout);
                }
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

        // If we already have a socket, clean it up first
        if (this.socket) {
            this.forceCleanup();
        }

        const socket = io(this.url, {
            auth,
            transports: ['websocket', 'polling', 'webtransport'],
            // TODO: test reconnection/transport failure scenarios
            reconnection: true,
            reconnectionAttempts: 3,
            reconnectionDelay: 500,
            reconnectionDelayMax: 1000,
            timeout: 5000,
            ackTimeout: 5000,
            retries: 10,
        });

        socket.on('connect', () => {
            const transport = socket.io.engine.transport.name; // in most cases, "polling"
            this.logger.info(
                `> Connected to SME ${this.url} (${transport}) [${socket.id}]`,
            );

            // Log detailed connection state
            this.logger.debug('Socket connection state:', {
                id: socket.id,
                connected: socket.connected,
                disconnected: socket.disconnected,
                transport: socket.io.engine.transport.name,
                readyState: socket.io.engine.readyState,
            });

            socket.io.engine.on('upgrade', () => {
                const upgradedTransport = socket.io.engine.transport.name;
                this.logger.info(
                    `> Upgraded connection to SME ${this.url} (${upgradedTransport}) [${socket.id}]`,
                );
                // Log post-upgrade state
                this.logger.debug('Socket post-upgrade state:', {
                    id: socket.id,
                    transport: upgradedTransport,
                    readyState: socket.io.engine.readyState,
                });
            });
        });

        // socket.on('disconnect', (reason) => {
        //     this.logger.warn(`Socket disconnected: ${reason} [${socket.id}]`);
        //     if (
        //         reason === 'ping timeout' ||
        //         reason === 'transport error' ||
        //         reason === 'transport close'
        //     ) {
        //         socket.disconnect();
        //         socket.connect();
        //     }
        // });

        socket.on('connect_error', (error: Error) => {
            this.logger.warn(
                `> Connect error to SME ${this.url}: ${error} [${socket.id}]`,
            );
        });

        // TODO: handle authenticated reconnections
        socket.on('reconnect', () => {
            this.logger.info(`> Reconnected to SME ${this.url} [${socket.id}]`);
        });

        socket.on('reconnect_attempt', (attempt: number) => {
            this.logger.debug(
                `> Reconnect attempt ${attempt} to SME ${this.url} [${socket.id}]`,
            );
        });

        socket.on('reconnect_error', (error: Error) => {
            this.logger.warn(
                `> Reconnect error to SME ${this.url}: ${error} [${socket.id}]`,
            );
        });

        socket.on('reconnect_failed', () => {
            this.logger.error(
                `> Failed to connect to SME ${this.url}. Giving up. [${socket.id}]`,
            );
            this.forceCleanup();
        });

        // const originalEmit = socket.emit;
        // const logger = this.logger;
        // socket.emit = function (event: string, ...args: unknown[]) {
        //     logger?.debug(
        //         'Socket emit state:',
        //         JSON.stringify({
        //             id: socket.id,
        //             event: event,
        //             connected: socket.connected,
        //             disconnected: socket.disconnected,
        //             transport: socket.io.engine.transport?.name,
        //             readyState: socket.io.engine.readyState,
        //         }),
        //     );
        //     return originalEmit.apply(socket, [event, ...args]);
        // }.bind(socket);

        // socket.io.on('ping', () => {
        //     this.logger.debug(
        //         'Socket.io ping:',
        //         JSON.stringify({
        //             id: socket.id,
        //             readyState: socket.io.engine?.readyState,
        //             transport: socket.io.engine?.transport?.name,
        //         }),
        //     );
        // });

        // socket.io.engine?.on('close', (reason: string) => {
        //     this.logger.debug(
        //         'Engine close event:',
        //         JSON.stringify({
        //             id: socket.id,
        //             reason,
        //             readyState: socket.io.engine?.readyState,
        //             transport: socket.io.engine?.transport?.name,
        //         }),
        //     );
        // });

        // socket.io.engine?.on('error', (err: string | Error) => {
        //     this.logger.debug(
        //         'Engine error event:',
        //         JSON.stringify({
        //             id: socket.id,
        //             error: err instanceof Error ? err.message : err,
        //             readyState: socket.io.engine?.readyState,
        //             transport: socket.io.engine?.transport?.name,
        //         }),
        //     );
        // });

        // socket.onAny((event, ...args) => {
        //     this.logger.debug(
        //         'Raw socket.io event:',
        //         JSON.stringify({
        //             event,
        //             args,
        //             hasAck: typeof args[args.length - 1] === 'function',
        //         }),
        //     );
        // });

        this.socket = socket;
    }
}
