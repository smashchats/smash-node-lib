import { encapsulateMessage } from '@src/api/tools/encapsulateMessage.js';
import { DIDManager } from '@src/core/identity/did/DIDManager.js';
import type { SmashPeer } from '@src/core/messaging/peer/SmashPeer.js';
import { IM_PROFILE } from '@src/shared/lexicon/improto.lexicon.js';
import type { DID, DIDString } from '@src/shared/types/did.types.js';
import type { EncapsulatedIMProtoMessage } from '@src/shared/types/message.types.js';
import type {
    IMProfile,
    IMProfileMessage,
} from '@src/shared/types/messages/index.js';
import type { Logger } from '@src/shared/utils/Logger.js';

export class PeerRegistry extends Map<DIDString, SmashPeer> {
    private ikToId: Record<string, DIDString> = {};
    private cachedEncapsulatedUserProfile?: EncapsulatedIMProtoMessage;
    private closed = false;

    constructor(
        private readonly logger: Logger,
        private readonly createNewPeer: (
            peerDid: DID,
            lastMessageTime: number,
        ) => Promise<SmashPeer>,
    ) {
        super();
    }

    getByIk(ik: string): SmashPeer | undefined {
        return this.get(this.ikToId[ik]);
    }

    async getOrCreate(
        did: DID,
        lastMessageTimestamp?: string,
    ): Promise<SmashPeer> {
        if (this.closed) {
            throw new Error('PeerRegistry closed');
        }

        const peerDid = await DIDManager.resolve(did);
        const existingPeer = this.get(peerDid.id);

        if (existingPeer) {
            this.ikToId[peerDid.ik] = existingPeer.id;
            return existingPeer;
        }

        const lastMessageTime = lastMessageTimestamp
            ? new Date(lastMessageTimestamp).getTime()
            : 0;

        this.logger.debug(`CreatePeer ${peerDid.id}`);
        const newPeer = await this.createNewPeer(peerDid, lastMessageTime);

        if (this.cachedEncapsulatedUserProfile) {
            await newPeer.queueMessage(this.cachedEncapsulatedUserProfile);
        }

        await newPeer.configureEndpoints();
        this.set(newPeer.id, newPeer);
        this.ikToId[peerDid.ik] = newPeer.id;

        return newPeer;
    }

    async updateUserProfile(profile: IMProfile) {
        await this.encapsulateProfileMessage(profile);

        await Promise.allSettled(
            Array.from(this.values()).map((peer) =>
                peer.send(this.cachedEncapsulatedUserProfile!),
            ),
        );
    }

    private async encapsulateProfileMessage(profile: IMProfile): Promise<void> {
        this.cachedEncapsulatedUserProfile = await encapsulateMessage({
            type: IM_PROFILE,
            data: profile,
            after: '',
        } as IMProfileMessage);
    }

    async closeAll() {
        this.closed = true;
        const peersToClose = Array.from(this.values());
        this.clear();
        return Promise.allSettled(peersToClose.map((peer) => peer.close()));
    }
}
