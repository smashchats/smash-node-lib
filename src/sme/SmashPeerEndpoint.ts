import { SmashPeer } from '@src/SmashPeer.js';
import { SignalSession } from '@src/signal/index.js';
import { EncapsulatedIMProtoMessage, SmashEndpoint } from '@src/types/index.js';
import AsyncLock from 'async-lock';

export class SmashPeerEndpoint {
    private session: SignalSession | undefined;
    private readonly messageQueue: Set<EncapsulatedIMProtoMessage> = new Set();
    // private readonly socket: SMESocketWriteOnly;

    constructor(
        private readonly peer: SmashPeer,
        public readonly endpointConfig: SmashEndpoint,
        historicalMessageQueue: Set<EncapsulatedIMProtoMessage>,
    ) {
        this.messageQueue = new Set([...historicalMessageQueue]);
    }

    private readonly mutex = new AsyncLock();

    queue(message: EncapsulatedIMProtoMessage): Promise<void> {
        return this.mutex.acquire('queue', async () => {
            this.messageQueue.add(message);
        });
    }

    /**
     * Flushes the message queue to the endpoint.
     * If the session is expired, it will be re-initialized.
     * @throws Error if message isnt delivered within 3 seconds.
     */
    async flush(): Promise<void> {
        return this.mutex.acquire('queue', async () => {
            await this.initSession();
            const undeliveredMessages = Array.from(this.messageQueue);
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
            this.messageQueue.add(
                await this.peer.getEncapsulatedProfileMessage(),
            );
            // this operation verifies both EK and the Endpoint's PreKey
            this.session = await this.peer.sessionManager.initSession(
                await this.peer.getDID(),
                this.endpointConfig,
            );
        }
    }
}
