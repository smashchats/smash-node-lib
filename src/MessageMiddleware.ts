import { PeerRegistry } from '@src/PeerRegistry.js';
import { SmashPeer } from '@src/SmashPeer.js';
import { DIDManager } from '@src/did/DIDManager.js';
import { DLQ } from '@src/signal/DLQ.js';
import {
    DID,
    DIDDocument,
    EncapsulatedIMProtoMessage,
    Firehose,
    IMDIDDocumentMessage,
    IMProfileMessage,
    IMReceivedACKMessage,
    IM_ACK_RECEIVED,
    IM_DID_DOCUMENT,
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
        const did = await this.tryToResolveDIDFromMessages(peerIk, messages);
        if (did) {
            await this.peers.getOrCreate(did);
            return this.flushPeerIkDLQ(peerIk);
        }
    }

    private async tryToResolveDIDFromMessages(
        peerIk: string,
        messages: EncapsulatedIMProtoMessage[],
    ): Promise<DIDDocument | undefined> {
        for (const message of messages) {
            try {
                if (message.type === IM_DID_DOCUMENT) {
                    return await this.resolveDIDFromDIDMessage(
                        peerIk,
                        message as IMDIDDocumentMessage,
                    );
                }
                if (message.type === IM_PROFILE) {
                    return await this.resolveDIDFromProfile(
                        peerIk,
                        message as IMProfileMessage,
                    );
                }
            } catch (err) {
                this.logger.debug(
                    `Failed to resolve DID from message: ${(err as Error).message}`,
                );
                continue;
            }
        }
        return undefined;
    }

    private async resolveDIDFromDIDMessage(
        peerIk: string,
        message: IMDIDDocumentMessage,
    ): Promise<DIDDocument> {
        const did = await DIDManager.resolve(message.data as DIDDocument);
        await this.validateDIDMatchesIk(did, peerIk);
        this.logger.debug(`Received DID in DID message for ${did.id}`);
        return did;
    }

    private async resolveDIDFromProfile(
        peerIk: string,
        message: IMProfileMessage,
    ): Promise<DIDDocument> {
        const did = await DIDManager.resolve(message.data.did as DID);
        await this.validateDIDMatchesIk(did, peerIk);
        this.logger.debug(`Received DID in profile for ${did.id}`);
        return did;
    }

    private async validateDIDMatchesIk(
        did: DIDDocument,
        peerIk: string,
    ): Promise<void> {
        if (peerIk !== did.ik) {
            // TODO: handle IK upgrades
            const err = 'Received IK doesnt match Signal Session data.';
            this.logger.error(err);
            throw new Error(err);
        }
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
