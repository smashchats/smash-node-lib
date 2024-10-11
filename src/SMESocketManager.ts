import { Identity } from '2key-ratchet';
import { SMESocketReadWrite, onMessagesFn } from '@src/SMESocketReadWrite.js';
import {
    SMESocketWriteOnly,
    onMessagesStatusFn,
} from '@src/SMESocketWriteOnly.js';
import { SessionManager } from '@src/SessionManager.js';
import { SMEConfig } from '@src/types/index.js';

export class SMESocketManager {
    private smeSockets: Record<string, SMESocketWriteOnly>;

    constructor(
        private onMessagesCallback: onMessagesFn,
        private onMessagesStatusCallback: onMessagesStatusFn,
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
        );
        if (this.smeSockets[smeConfig.url]) {
            Object.assign(this.smeSockets[smeConfig.url], smeSocket);
            // TODO is it needed to close old upgraded socket?
        }
        this.smeSockets[smeConfig.url] = smeSocket;
        return smeSocket.initSocketWithAuth(identity, smeConfig);
    }
}
