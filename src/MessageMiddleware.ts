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
            `Processing ${messages?.length} messages from IK ${peerIk}`,
        );

        const peer = this.peers.getByIk(peerIk);
        if (!peer) {
            return this.handleUnknownPeer(peerIk, messages);
        }

        const uniqueMessages = this.filterUniqueMessages(messages);
        if (uniqueMessages.length === 0) {
            this.logger.debug(
                'All messages were duplicates, skipping processing',
            );
            return;
        }

        await this.processMessages(peer, uniqueMessages);
    }

    private async handleUnknownPeer(
        peerIk: string,
        messages: EncapsulatedIMProtoMessage[],
    ): Promise<void> {
        // TODO: handle profile/DID updates (for now only handles IK updates)
        // TODO: split DID updates from profile updates
        this.dlq.push(peerIk, ...messages);
        this.logger.debug(
            `Queued ${messages.length} messages from unknown peer (IK: ${peerIk})`,
        );

        const did = await this.resolvePeerDID(peerIk, messages);
        if (did) {
            await this.peers.getOrCreate(did);
            await this.processDLQMessages(peerIk);
        }
    }

    private async resolvePeerDID(
        peerIk: string,
        messages: EncapsulatedIMProtoMessage[],
    ): Promise<DIDDocument | undefined> {
        for (const message of messages) {
            try {
                if (message.type === IM_DID_DOCUMENT) {
                    return this.resolveDIDFromDIDMessage(
                        peerIk,
                        message as IMDIDDocumentMessage,
                    );
                }
                if (message.type === IM_PROFILE) {
                    return this.resolveDIDFromProfile(
                        peerIk,
                        message as IMProfileMessage,
                    );
                }
            } catch (err) {
                this.logger.debug(
                    `Failed to resolve DID from message: ${(err as Error).message}`,
                );
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
        this.logger.debug(`Resolved DID from DID message: ${did.id}`);
        return did;
    }

    private async resolveDIDFromProfile(
        peerIk: string,
        message: IMProfileMessage,
    ): Promise<DIDDocument> {
        const did = await DIDManager.resolve(message.data.did as DID);
        await this.validateDIDMatchesIk(did, peerIk);
        this.logger.debug(`Resolved DID from profile: ${did.id}`);
        return did;
    }

    private async validateDIDMatchesIk(
        did: DIDDocument,
        peerIk: string,
    ): Promise<void> {
        if (peerIk !== did.ik) {
            throw new Error('Received IK does not match Signal Session data');
        }
    }

    private async processDLQMessages(peerIk: string): Promise<void> {
        const messages = this.dlq.get(peerIk);
        if (!messages?.length) return;

        this.logger.debug(`Processing queued messages for ${peerIk}`);
        await this.handle(peerIk, messages);
        this.dlq.delete(peerIk);
    }

    private filterUniqueMessages(
        messages: EncapsulatedIMProtoMessage[],
    ): EncapsulatedIMProtoMessage[] {
        const now = Date.now();
        return messages.filter((msg) => {
            if (this.processedMessages.has(msg.sha256)) {
                return false;
            }
            this.processedMessages.set(msg.sha256, now);
            return true;
        });
    }

    private async processMessages(
        peer: SmashPeer,
        messages: EncapsulatedIMProtoMessage[],
    ): Promise<void> {
        await this.firehose(peer.id, messages);
        await this.sendReceivedAcks(peer, messages);
        this.logger.info(
            `Processed ${messages.length} unique messages from ${peer.id}`,
        );
    }

    private async sendReceivedAcks(
        peer: SmashPeer,
        messages: EncapsulatedIMProtoMessage[],
    ): Promise<void> {
        const messagesToAck = messages.filter(
            (m) => m.type !== IM_ACK_RECEIVED,
        );
        if (!messagesToAck.length) return;

        this.logger.debug(
            `Sending ${messagesToAck.length} received acknowledgements`,
        );
        await peer.send({
            type: IM_ACK_RECEIVED,
            data: messagesToAck.map((m) => m.sha256),
        } as IMReceivedACKMessage);
    }
}
