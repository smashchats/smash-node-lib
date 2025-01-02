// class ProfileListHandler extends BaseResolver<
//     SmashChatProfileListMessage,
//     SmashProfileList
// > {
//     constructor(private readonly neighborhoodAdminIDs: string[]) {
//         super(SMASH_PROFILE_LIST);
//     }
//     resolve(
//         peer: SmashPeer,
//         message: SmashChatProfileListMessage,
//     ): Promise<SmashProfileList> {
//         if (this.neighborhoodAdminIDs.includes(peer.id)) {
//             return Promise.resolve(message.data as SmashProfileList);
//         }
//         return Promise.reject(new Error('Not a neighborhood admin'));
//     }
// }
import { SmashMessaging } from '@src/SmashMessaging.js';
import { SmashPeer } from '@src/SmashPeer.js';
import { SMASH_NBH_JOIN_MESSAGE } from '@src/const.js';
import { SmashActionJson } from '@src/types/action.types.js';
import { DIDString } from '@src/types/did.types.js';
import { SMASH_NBH_ADDED } from '@src/types/smashchats.lexicon.js';

declare module '@src/types/events.js' {
    interface CustomEventMap {
        [SMASH_NBH_ADDED]: [DIDString];
    }
}

export class SmashUser extends SmashMessaging {
    private readonly neighborhoodAdminIDs: string[] = [];
    private readonly neighborhoodAdmins: SmashPeer[] = [];

    public async join(joinAction: SmashActionJson) {
        // Initialize endpoints if SME config is provided
        if (joinAction.config?.sme?.length) {
            await Promise.all(
                joinAction.config?.sme?.map((smeConfig) =>
                    this.identity
                        .generateNewPreKeyPair()
                        .then((preKeyPair) =>
                            this.endpoints.connect(smeConfig, preKeyPair),
                        ),
                ),
            );
            this.logger.debug(
                `Connected to ${joinAction.config?.sme?.length} endpoints configured by join action config.`,
            );
        }
        const nabPeer = await this.peers.getOrCreate(joinAction.did);
        await nabPeer.send(SMASH_NBH_JOIN_MESSAGE);
        // Add neighborhood admin (NAB) and emit user event
        this.neighborhoodAdminIDs.push(nabPeer.id);
        this.neighborhoodAdmins.push(nabPeer);
        this.emit(SMASH_NBH_ADDED, nabPeer.id);
    }

    //     private async setRelationship(userDid: DID, action: Relationship) {
    //         (await this.getOrCreatePeer(userDid)).setRelationship(
    //             action,
    //             this.neighborhoodAdmins,
    //         );
    //     }
    //     public smash(userDid: DID) {
    //         return this.setRelationship(userDid, 'smash');
    //     }
    //     public pass(userDid: DID) {
    //         return this.setRelationship(userDid, 'pass');
    //     }
    //     public clear(userDid: DID) {
    //         return this.setRelationship(userDid, 'clear');
    //     }
    //     public discover() {
    //         // TODO: handle for multiple NABs
    //         return this.neighborhoodAdmins[0].sendMessage(
    //             SMASH_NBH_DISCOVER_MESSAGE,
    //         );
    //     }
}
