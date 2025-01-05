import { SmashPeer } from '@src/SmashPeer.js';
import { DIDManager } from '@src/did/DIDManager.js';
import {
    DID,
    DIDString,
    EncapsulatedIMProtoMessage,
    IMProfile,
    IMProfileMessage,
    IM_PROFILE,
} from '@src/types/index.js';
import { CryptoUtils } from '@src/utils/CryptoUtils.js';
import { Logger } from '@src/utils/Logger.js';

// TODO: handle differential profile updates?
// TODO: handle updates from other peers IF signed (and with proper trusting level—ie. not from any peer & only ADDING not replacing/removing endpoints if not from the peer itself )

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
        this.cachedEncapsulatedUserProfile =
            await CryptoUtils.singleton.encapsulateMessage({
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
