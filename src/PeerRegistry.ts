import { SmashMessaging } from '@src/SmashMessaging.js';
import { SmashPeer } from '@src/SmashPeer.js';
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

export class PeerRegistry extends Map<DIDString, SmashPeer> {
    constructor(
        private readonly logger: Logger,
        private readonly createNewPeer: (
            peerDid: DID,
            lastMessageTime: number,
        ) => Promise<SmashPeer>,
    ) {
        super();
    }

    private ikToId: Record<string, DIDString> = {};

    getByIk(ik: string): SmashPeer | undefined {
        return this.get(this.ikToId[ik]);
    }

    // TODO: handle DID update
    // TODO: split profile from DID updates?
    // TODO: handle differential profile updates?
    // TODO: handle updates from other peers IF signed (and with proper trusting level—ie. not from any peer & only ADDING not replacing/removing endpoints if not from the peer itself )

    async getOrCreate(
        did: DID,
        lastMessageTimestamp?: string,
    ): Promise<SmashPeer> {
        const peerDid = await SmashMessaging.resolve(did);
        const peer = this.get(peerDid.id);
        if (!peer) {
            this.logger.debug(`CreatePeer ${peerDid.id}`);
            const lastMessageTime = lastMessageTimestamp
                ? new Date(lastMessageTimestamp).getTime()
                : 0;
            const peer = await this.createNewPeer(peerDid, lastMessageTime);
            if (this.cachedEncapsulatedUserProfile)
                await peer.queueMessage(this.cachedEncapsulatedUserProfile);
            await peer.configureEndpoints();
            this.set(peer.id, peer);
            return peer;
        }
        // always remap IK to ID (TODO handle profile/DID updates)
        this.ikToId[peerDid.ik] = peer.id;
        return peer;
    }

    async updateUserProfile(profile: IMProfile) {
        // cache profile message
        await this.encapsulateProfileMessage(profile);
        // send to all registered peers
        await Promise.allSettled(
            Array.from(this.values()).map((peer: SmashPeer) =>
                peer.send(this.cachedEncapsulatedUserProfile!),
            ),
        );
    }

    private cachedEncapsulatedUserProfile:
        | EncapsulatedIMProtoMessage
        | undefined;
    private async encapsulateProfileMessage(profile: IMProfile): Promise<void> {
        this.cachedEncapsulatedUserProfile =
            await CryptoUtils.singleton.encapsulateMessage({
                type: IM_PROFILE,
                data: profile,
                // TODO: profile differential updates (no need to send profile if already propagated)
                after: '',
            } as IMProfileMessage);
    }
}
