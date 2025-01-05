import { SessionManager } from '@src/signal/index.js';
import { SMESocketReadWrite } from '@src/sme/SMESocketReadWrite.js';
import { SMESocketWriteOnly } from '@src/sme/SMESocketWriteOnly.js';
import {
    EncapsulatedIMProtoMessage,
    IECKeyPair,
    IMSessionEndpointMessage,
    IM_SESSION_ENDPOINT,
    SMEConfigJSONWithoutDefaults,
    SmashEndpoint,
    onMessagesStatusFn,
} from '@src/types/index.js';
import { CryptoUtils, Logger } from '@src/utils/index.js';

export class SMESocketManager {
    private readonly smeSockets: Record<string, SMESocketWriteOnly>;
    private closed: boolean = false;

    constructor(
        private readonly logger: Logger,
        private readonly onMessagesStatusCallback: onMessagesStatusFn,
    ) {
        this.smeSockets = {};
    }

    getOrCreate(url: string): SMESocketWriteOnly {
        if (this.closed) {
            throw new Error('SMESocketManager is closed');
        }
        if (!this.smeSockets[url]) {
            this.logger.debug(`Creating new SMESocketWriteOnly for ${url}`);
            this.smeSockets[url] = new SMESocketWriteOnly(
                this.logger,
                url,
                this.onMessagesStatusCallback,
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
        url: string,
        smeConfig: SMEConfigJSONWithoutDefaults,
        signingKey: IECKeyPair,
        preKeyPair: IECKeyPair,
        sessionManager: SessionManager,
    ): Promise<SmashEndpoint> {
        this.logger.debug(
            `Initializing SMESocketManager with auth for ${url}`,
            JSON.stringify(smeConfig),
        );
        // let's create a new RW socket to hold the state of our new authd endpoint
        const smeSocket = new SMESocketReadWrite(
            this.logger,
            url,
            this.onMessagesStatusCallback,
            sessionManager,
        );
        // we attempt to initialize the socket with auth
        // in case of failure, this will throw an error
        const endpoint = await smeSocket.initSocketWithAuth(
            signingKey,
            preKeyPair,
            smeConfig,
        );
        // if no error has been thrown, we can safely store the new socket
        // replacing any potential existing one.
        const oldSocket = this.smeSockets[smeConfig.url];
        this.smeSockets[smeConfig.url] = smeSocket;
        await oldSocket?.close();
        // if no preferred endpoint has been set yet, set this one as preferred
        // TODO dynamically select preferred based on metrics
        if (!this.cachedPEMessage) {
            this.logger.debug(
                `Setting user's preferred endpoint to ${endpoint.url}`,
            );
            this.cachedPEMessage =
                await CryptoUtils.singleton.encapsulateMessage({
                    type: IM_SESSION_ENDPOINT,
                    data: endpoint,
                } as IMSessionEndpointMessage);
        }
        // and return the configured endpoint
        return endpoint;
    }

    async closeAllSockets() {
        this.closed = true;
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
