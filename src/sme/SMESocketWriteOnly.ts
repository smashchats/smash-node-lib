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
        if (this.socket.io?.engine) {
            this.socket.io.engine.removeAllListeners();
            this.socket.io.engine.close();
            this.socket.io.engine.transport?.close();
        }
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
        TIMEOUT_MS: number = 5000,
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!messageIds.length) {
                this.logger.warn(
                    `Called sendData with no messageIds [${this.socket?.id}]`,
                );
                return resolve();
            }
            if (!this.socket || this.socket.disconnected) {
                this.logger.info(
                    `Creating write-only socket for ${this.url} [prev: ${this.socket?.id}]`,
                );
                this.forceCleanup();
                this.initSocket();
                if (!this.socket) {
                    return reject(
                        new Error(`Failed to connect to SME ${this.url}`),
                    );
                }
            }
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
                this.onMessagesStatusCallback('delivered', messageIds);
                resolve();
            });
        });
    }

    protected initSocket(auth?: SMEAuthParams) {
        this.logger.debug(
            `SMESocketWriteOnly::initSocket ${this.url} ${auth ? 'with auth' : 'without auth'}`,
        );

        const socket = io(this.url, {
            auth,
            transports: ['websocket', 'polling', 'webtransport'],
        });

        socket.on('connect', () => {
            const transport = socket.io.engine.transport.name; // in most cases, "polling"
            this.logger.info(
                `> Connected to SME ${this.url} (${transport}) [${this.socket?.id}]`,
            );
            socket.io.engine.on('upgrade', () => {
                const upgradedTransport = socket.io.engine.transport.name; // in most cases, "websocket"
                this.logger.info(
                    `> Upgraded connection to SME ${this.url} (${upgradedTransport}) [${this.socket?.id}]`,
                );
            });
        });

        socket.on('connect_error', (error: Error) => {
            this.logger.warn(
                `> Connect error to SME ${this.url}: ${error} [${this.socket?.id}]`,
            );
        });

        socket.on('ping', () => {
            this.logger.debug(
                `> Ping from SME ${this.url} [${this.socket?.id}]`,
            );
        });

        socket.on('reconnect', () => {
            this.logger.info(
                `> Reconnected to SME ${this.url} [${this.socket?.id}]`,
            );
        });

        socket.on('reconnect_attempt', (attempt: number) => {
            this.logger.debug(
                `> Reconnect attempt ${attempt} to SME ${this.url} [${this.socket?.id}]`,
            );
        });

        socket.on('reconnect_error', (error: Error) => {
            this.logger.warn(
                `> Reconnect error to SME ${this.url}: ${error} [${this.socket?.id}]`,
            );
        });

        socket.on('reconnect_failed', () => {
            this.logger.error(
                `> Failed to connect to SME ${this.url}. Giving up. [${this.socket?.id}]`,
            );
            this.forceCleanup();
        });
        this.socket = socket;
    }
}
