import { SessionManager } from '@src/signal/index.js';
import { SMESocketReadWrite } from '@src/sme/SMESocketReadWrite.js';
import { SMESocketWriteOnly } from '@src/sme/SMESocketWriteOnly.js';
import {
    EncapsulatedIMProtoMessage,
    IMSessionEndpointMessage,
    IM_SESSION_ENDPOINT,
    Identity,
    SMEConfig,
    SmashEndpoint,
    onMessagesFn,
    onMessagesStatusFn,
} from '@src/types/index.js';
import { CryptoUtils, Logger } from '@src/utils/index.js';

export class SMESocketManager {
    private readonly smeSockets: Record<string, SMESocketWriteOnly>;

    constructor(
        private readonly onMessagesCallback: onMessagesFn,
        private readonly onMessagesStatusCallback: onMessagesStatusFn,
        private readonly logger: Logger,
    ) {
        this.smeSockets = {};
    }

    getOrCreate(url: string): SMESocketWriteOnly {
        if (!this.smeSockets[url]) {
            this.logger.debug(`Creating new SMESocketWriteOnly for ${url}`);
            this.smeSockets[url] = new SMESocketWriteOnly(
                url,
                this.onMessagesStatusCallback,
                this.logger,
            );
        } else {
            this.logger.debug(`Reusing existing socket for ${url}`);
        }
        return this.smeSockets[url];
    }

    /**
     * Initializes a new socket with auth for the given endpoint.
     * If a socket is already configured for the endpoint, it will be reused.
     * @throws if the socket cannot be initialized with auth.
     * @param identity
     * @param smeConfig
     * @param sessionManager
     * @returns the configured endpoint
     */
    async initWithAuth(
        identity: Identity,
        smeConfig: SMEConfig,
        sessionManager: SessionManager,
    ): Promise<SmashEndpoint> {
        // let's create a new RW socket to hold the state of our new authd endpoint
        const smeSocket = new SMESocketReadWrite(
            smeConfig.url,
            sessionManager,
            this.onMessagesCallback,
            this.onMessagesStatusCallback,
            this.logger,
        );
        // we attempt to initialize the socket with auth
        // in case of failure, this will throw an error
        const endpoint = await smeSocket.initSocketWithAuth(
            identity,
            smeConfig,
        );
        // if no error has been thrown, we can safely store the new socket
        // replacing the old one.
        const oldSocket = this.smeSockets[smeConfig.url];
        this.smeSockets[smeConfig.url] = smeSocket;
        await oldSocket?.close();
        // and return the configured endpoint
        if (!this.cachedPEMessage) {
            // TODO dynamically select preferred based on metrics
            this.logger.debug(
                `Setting user's preferred endpoint to ${endpoint.url}`,
            );
            this.cachedPEMessage =
                await CryptoUtils.singleton.encapsulateMessage({
                    type: IM_SESSION_ENDPOINT,
                    data: endpoint,
                } as IMSessionEndpointMessage);
        }
        return endpoint;
    }

    async closeAllSockets() {
        return Promise.allSettled(
            Object.values(this.smeSockets).map((socket) =>
                this.closeSocket(socket),
            ),
        );
    }

    private cachedPEMessage?: EncapsulatedIMProtoMessage;
    getPreferredEndpointMessage(): EncapsulatedIMProtoMessage {
        if (!this.cachedPEMessage) {
            throw new Error('Preferred endpoint not set');
        }
        return this.cachedPEMessage;
    }

    /**
     * Closes the socket for the given endpoint URL.
     * @param url
     */
    async close(url: string) {
        if (this.smeSockets[url]) {
            await this.closeSocket(this.smeSockets[url]);
        }
    }

    private async closeSocket(socket: SMESocketWriteOnly) {
        await socket.close();
        delete this.smeSockets[socket.url];
    }
}
