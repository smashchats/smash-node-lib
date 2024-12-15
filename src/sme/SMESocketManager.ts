import { SessionManager } from '@src/signal/index.js';
import { SMESocketReadWrite } from '@src/sme/SMESocketReadWrite.js';
import { SMESocketWriteOnly } from '@src/sme/SMESocketWriteOnly.js';
import {
    Identity,
    SMEConfig,
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

    async closeAllSockets() {
        const promises = Object.values(this.smeSockets).map((socket) =>
            socket.close(),
        );
        await Promise.allSettled(promises);
    }

    getOrCreate(url: string) {
        if (!this.smeSockets[url])
            this.smeSockets[url] = new SMESocketWriteOnly(
                url,
                this.onMessagesStatusCallback,
                this.logger,
            );
        return this.smeSockets[url];
    }

    initWithAuth(
        identity: Identity,
        smeConfig: SMEConfig,
        sessionManager: SessionManager,
    ) {
        const smeSocket = new SMESocketReadWrite(
            smeConfig.url,
            sessionManager,
            this.onMessagesCallback,
            this.onMessagesStatusCallback,
            this.logger,
        );
        if (this.smeSockets[smeConfig.url]) {
            Object.assign(this.smeSockets[smeConfig.url], smeSocket);
            // TODO is it needed to close old upgraded socket?
        }
        this.smeSockets[smeConfig.url] = smeSocket;
        return smeSocket.initSocketWithAuth(identity, smeConfig);
    }
}
