import { SmashMessaging } from '@src/SmashMessaging.js';
import { SmashPeer } from '@src/SmashPeer.js';
import {
    SMASH_NBH_DISCOVER_MESSAGE,
    SMASH_NBH_JOIN_MESSAGE,
} from '@src/const.js';
import { SmashActionJson } from '@src/types/action.types.js';
import { DIDString } from '@src/types/did.types.js';
import { SmashProfileList } from '@src/types/smash.types.js';
import {
    NBH_ADDED,
    NBH_PROFILE_LIST,
    SMASH_PROFILE_LIST,
} from '@src/types/smashchats.lexicon.js';

declare module '@src/types/events.js' {
    interface CustomEventMap {
        [NBH_ADDED]: [DIDString];
        [NBH_PROFILE_LIST]: [DIDString, SmashProfileList];
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
        this.emit(NBH_ADDED, nabPeer.id);
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

    public async discover() {
        // TODO: handle for multiple NABs
        await this.neighborhoodAdmins[0].send(SMASH_NBH_DISCOVER_MESSAGE);
    }

    constructor(...args: ConstructorParameters<typeof SmashMessaging>) {
        super(...args);
        this.on(SMASH_PROFILE_LIST, (did, message) => {
            this.logger.debug(`onProfileList ${did} ${message.sha256}`);
            if (this.neighborhoodAdminIDs.includes(did)) {
                this.emit(
                    NBH_PROFILE_LIST,
                    did,
                    message.data as SmashProfileList,
                );
            }
        });
    }
}
