import { SmashMessaging } from '@src/SmashMessaging.js';
import { SmashPeer } from '@src/SmashPeer.js';
import { BaseResolver } from '@src/callbacks/BaseResolver.js';
import {
    SMASH_NBH_DISCOVER_MESSAGE,
    SMASH_NBH_JOIN_MESSAGE,
} from '@src/const.js';
import {
    DID,
    Relationship,
    SMASH_NBH_ADDED,
    SMASH_NBH_PROFILE_LIST,
    SMASH_PROFILE_LIST,
    SmashActionJson,
    SmashChatProfileListMessage,
    SmashProfileList,
} from '@src/types/index.js';

class ProfileListHandler extends BaseResolver<
    SmashChatProfileListMessage,
    SmashProfileList
> {
    constructor(private readonly neighborhoodAdminIDs: string[]) {
        super(SMASH_PROFILE_LIST);
    }
    resolve(
        peer: SmashPeer,
        message: SmashChatProfileListMessage,
    ): Promise<SmashProfileList> {
        if (this.neighborhoodAdminIDs.includes(peer.id)) {
            return Promise.resolve(message.data as SmashProfileList);
        }
        return Promise.reject(new Error('Not a neighborhood admin'));
    }
}

export class SmashUser extends SmashMessaging {
    constructor(...args: ConstructorParameters<typeof SmashMessaging>) {
        super(...args);
        this.superRegister(
            SMASH_NBH_PROFILE_LIST,
            new ProfileListHandler(this.neighborhoodAdminIDs),
        );
    }

    private readonly neighborhoodAdminIDs: string[] = [];
    private readonly neighborhoodAdmins: SmashPeer[] = [];

    public async join(joinAction: SmashActionJson) {
        // Initialize endpoints if SME config is provided
        if (joinAction.config?.sme) {
            await this.initEndpoints(joinAction.config.sme);
        }
        // Create or get NAB peer and send join message
        const nabPeer = await this.getOrCreatePeer(joinAction.did);
        await nabPeer.sendMessage(SMASH_NBH_JOIN_MESSAGE);
        // Add neighborhood admin (NAB) and emit user event
        this.neighborhoodAdminIDs.push(nabPeer.id);
        this.neighborhoodAdmins.push(nabPeer);
        this.emit(SMASH_NBH_ADDED, nabPeer.id);
    }

    private async setRelationship(userDid: DID, action: Relationship) {
        (await this.getOrCreatePeer(userDid)).setRelationship(
            action,
            this.neighborhoodAdmins,
        );
    }

    public smash(userDid: DID) {
        return this.setRelationship(userDid, 'smash');
    }

    public pass(userDid: DID) {
        return this.setRelationship(userDid, 'pass');
    }

    public clear(userDid: DID) {
        return this.setRelationship(userDid, 'clear');
    }

    public discover() {
        // TODO: handle for multiple NABs
        return this.neighborhoodAdmins[0].sendMessage(
            SMASH_NBH_DISCOVER_MESSAGE,
        );
    }
}
