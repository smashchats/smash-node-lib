import { SmashPeer } from '@src/SmashPeer.js';
import { SignalSession } from '@src/signal/index.js';
import {
    EncapsulatedIMProtoMessage,
    SmashEndpoint,
    sha256,
} from '@src/types/index.js';
import AsyncLock from 'async-lock';

export class SmashPeerEndpoint {
    private session: SignalSession | undefined;
    private readonly messageQueue: Map<sha256, EncapsulatedIMProtoMessage> =
        new Map();
    // private readonly socket: SMESocketWriteOnly;

    constructor(
        private readonly peer: SmashPeer,
        public readonly endpointConfig: SmashEndpoint,
        historicalMessageQueue: Map<sha256, EncapsulatedIMProtoMessage>,
    ) {
        this.messageQueue = new Map([...historicalMessageQueue]);
    }

    private readonly mutex = new AsyncLock();

    queue(message: EncapsulatedIMProtoMessage): Promise<void> {
        return this.mutex.acquire('queue', () => {
            this.messageQueue.set(message.sha256, message);
        });
    }

    async ack(messageIds: sha256[]) {
        return this.mutex.acquire('queue', () => {
            messageIds.forEach((messageId) => {
                this.messageQueue.delete(messageId);
            });
        });
    }

    /**
     * Flushes the message queue to the endpoint.
     * If the session is expired, it will be re-initialized.
     * @throws Error if message isnt delivered within 3 seconds.
     */
    async flush(): Promise<void> {
        await this.initSession();
        return this.mutex.acquire('queue', async () => {
            const undeliveredMessages = Array.from(this.messageQueue.values());
            if (!undeliveredMessages.length) {
                this.peer.logger.debug(
                    `> no undelivered messages for ${this.endpointConfig.url}`,
                );
                return;
            }
            this.peer.logger.debug(
                `> flushing ${undeliveredMessages.length} messages to ${this.endpointConfig.url}`,
            );
            const socket = this.peer.smeSocketManager.getOrCreate(
                this.endpointConfig.url,
            );
            try {
                await socket.sendData(
                    this.endpointConfig.preKey,
                    this.session!.id,
                    await this.session!.encryptMessages(undeliveredMessages),
                    undeliveredMessages.map((m) => m.sha256),
                );
                this.messageQueue.clear();
            } catch (error) {
                this.peer.logger.error(
                    `> failed to flush messages to ${this.endpointConfig.url}: ${(error as Error).message}`,
                );
                this.peer.logger.info(
                    `> resetting session: ${this.session?.id}`,
                );
                // TODO: is reset session really needed everytime here?
                this.session = undefined;
                throw error;
            }
        });
    }

    private async initSession() {
        if (!this.session || this.session.isExpired()) {
            if (this.session) {
                this.peer.logger.info(
                    `> /!\\ expired session with ${this.peer.id} @ ${this.endpointConfig.url}`,
                );
            }
            this.peer.logger.debug(
                `> initializing new session with ${this.peer.id} @ ${this.endpointConfig.url}`,
            );
            // ensure user profile is sent at the start of every new session
            await this.queue(await this.peer.getEncapsulatedProfileMessage());
            // this operation verifies both EK and the Endpoint's PreKey
            this.session = await this.peer.sessionManager.initSession(
                await this.peer.getDID(),
                this.endpointConfig,
            );
        }
    }
}
