import { SessionManager } from '@src/signal/index.js';
import { SMESocketReadWrite } from '@src/sme/SMESocketReadWrite.js';
import { SMESocketWriteOnly } from '@src/sme/SMESocketWriteOnly.js';
import {
    Identity,
    SMEConfig,
    SmashEndpoint,
    onMessagesFn,
    onMessagesStatusFn,
} from '@src/types/index.js';
import { Logger } from '@src/utils/index.js';

export class SMESocketManager {
    private readonly smeSockets: Record<string, SMESocketWriteOnly>;

    constructor(
        private readonly onMessagesCallback: onMessagesFn,
        private readonly onMessagesStatusCallback: onMessagesStatusFn,
        private readonly logger: Logger,
    ) {
        this.smeSockets = {};
    }

    getOrCreate(url: string) {
        if (!this.smeSockets[url]) {
            this.logger.debug(`Creating new SMESocketWriteOnly for ${url}`);
            this.smeSockets[url] = new SMESocketWriteOnly(
                url,
                this.onMessagesStatusCallback,
                this.logger,
            );
        } else {
            this.logger.debug(`Reusing existing SMESocketWriteOnly for ${url}`);
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
        // ASSUMPTION#3: Endpoints can be uniquely identified by their URL.
        // if a socket is already configured for this url,
        if (this.smeSockets[smeConfig.url]) {
            // we copy its state to the new socket attempt
            Object.assign(this.smeSockets[smeConfig.url], smeSocket);
        }
        // we attempt to initialize the socket with auth
        // in case of failure, this will throw an error
        const endpoint = await smeSocket.initSocketWithAuth(
            identity,
            smeConfig,
        );
        // if no error has been thrown, we can safely store the new socket
        // replacing the old one.
        this.smeSockets[smeConfig.url] = smeSocket;
        // and return the configured endpoint
        return endpoint;
    }

    async closeAllSockets() {
        await Promise.allSettled(
            Object.values(this.smeSockets).map((socket) =>
                this.closeSocket(socket),
            ),
        );
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
