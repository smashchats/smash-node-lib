import { PeerRegistry } from '@src/PeerRegistry.js';
import { SmashMessaging } from '@src/SmashMessaging.js';
import { SmashPeer } from '@src/SmashPeer.js';
import { DLQ } from '@src/signal/DLQ.js';
import {
    DID,
    DIDDocument,
    EncapsulatedIMProtoMessage,
    Firehose,
    IMProfileMessage,
    IMReceivedACKMessage,
    IM_ACK_RECEIVED,
    IM_PROFILE,
} from '@src/types/index.js';
import { Logger } from '@src/utils/Logger.js';

export class MessageMiddleware {
    // TODO: use expiring cache mechanism
    private readonly processedMessages = new Map<string, number>();
    private readonly dlq = new DLQ<string, EncapsulatedIMProtoMessage>();

    constructor(
        private readonly logger: Logger,
        private readonly peers: PeerRegistry,
        private readonly firehose: Firehose,
    ) {}

    async handle(
        peerIk: string,
        messages: EncapsulatedIMProtoMessage[],
    ): Promise<void> {
        this.logger.debug(
            `processing ${messages?.length} messages from Ik ${peerIk}`,
        );
        const peer: SmashPeer | undefined = this.peers.getByIk(peerIk);
        if (peer) {
            const uniqueMessages = this.deduplicateMessages(messages);
            if (uniqueMessages.length === 0) {
                this.logger.debug(
                    'All messages were duplicates, skipping processing',
                );
                return;
            }
            // process messages, firehose data events
            await this.firehose(peer.id, uniqueMessages);
            // send received ACKs to the sending peer ONCE processed
            await this.sendReceivedAcks(peer, uniqueMessages);
            this.logger.info(
                `processed ${uniqueMessages?.length} unique messages from ${peer.id}`,
            );
        } else {
            this.dlq.push(peerIk, ...messages);
            this.logger.debug(
                `DLQd ${messages.length} messages from unknown peer (IK: ${peerIk})`,
            );
            return this.parseMissingPeerInformation(peerIk, messages);
        }
    }

    private async parseMissingPeerInformation(
        peerIk: string,
        messages: EncapsulatedIMProtoMessage[],
    ): Promise<void> {
        // TODO: handle profile/DID updates (for now only handles IK updates)
        // TODO: split DID updates from profile updates
        const results = await Promise.allSettled(
            messages.map((message) =>
                this.tryToCatchDIDFromProfile(peerIk, message),
            ),
        );
        const did = results.find(
            (result) => result.status === 'fulfilled',
        )?.value;
        if (did) {
            await this.peers.getOrCreate(did);
            return this.flushPeerIkDLQ(peerIk);
        }
    }

    private async tryToCatchDIDFromProfile(
        peerIk: string,
        message: EncapsulatedIMProtoMessage,
    ): Promise<DIDDocument> {
        if (message.type !== IM_PROFILE) {
            throw new Error('Received non-profile message type');
        }
        const did = await SmashMessaging.resolve(
            (message as IMProfileMessage).data.did as DID,
        );
        if (peerIk !== did.ik) {
            // TODO: handle IK upgrades
            const err = 'Received IK doesnt match Signal Session data.';
            this.logger.error(err);
            throw new Error(err);
        } else {
            this.logger.debug(`Received DID in profile for ${did.id}`);
        }
        return did;
    }

    private async flushPeerIkDLQ(peerIk: string): Promise<void> {
        const messages = this.dlq.get(peerIk);
        if (!messages?.length) return;
        this.logger.debug(`Flushing DLQ for ${peerIk}`);
        await this.handle(peerIk, messages);
        this.dlq.delete(peerIk);
    }

    private deduplicateMessages(messages: EncapsulatedIMProtoMessage[]) {
        const now = Date.now();
        return messages.filter((msg) => {
            if (this.processedMessages.has(msg.sha256)) {
                return false;
            }
            this.processedMessages.set(msg.sha256, now);
            return true;
        });
    }

    private async sendReceivedAcks(
        peer: SmashPeer,
        messages: EncapsulatedIMProtoMessage[],
    ) {
        const acks = messages.filter((m) => m.type !== IM_ACK_RECEIVED);
        if (!acks.length) return;
        this.logger.debug(`sendReceivedAcks: ${acks.length}`);
        return peer.send({
            type: IM_ACK_RECEIVED,
            data: acks.map((m) => m.sha256),
        } as IMReceivedACKMessage);
    }
}
