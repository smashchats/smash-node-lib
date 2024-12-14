import { SmashMessaging } from '@src/SmashMessaging.js';
import { SmashPeer } from '@src/SmashPeer.js';
import {
    SMASH_NBH_DISCOVER_MESSAGE,
    SMASH_NBH_JOIN_MESSAGE,
} from '@src/const.js';
import { DIDResolver } from '@src/did/index.js';
import {
    DID,
    EncapsulatedIMProtoMessage,
    JoinAction,
    Relationship,
    SmashProfileList,
} from '@src/types/index.js';

export class SmashUser extends SmashMessaging {
    private neighborhoodAdminIDs: string[] = [];
    private neighborhoodAdmins: SmashPeer[] = [];

    async join(joinAction: JoinAction) {
        // Initialize endpoints if SME config is provided
        if (joinAction.config?.sme) {
            await this.initEndpoints(joinAction.config.sme);
        }
        // Create or get NAB peer and send join message
        const nabPeer = await this.getOrCreatePeer(joinAction.did);
        await nabPeer.sendMessage(SMASH_NBH_JOIN_MESSAGE);
        // Add neighborhood admin (NAB) and emit user event
        const nabDid = await nabPeer.getDID();
        this.neighborhoodAdminIDs.push(nabDid.id);
        this.neighborhoodAdmins.push(nabPeer);
        this.emit('nbh_added', nabDid);
    }

    private async setRelationship(userDid: DID, action: Relationship) {
        (await this.getOrCreatePeer(userDid)).setRelationship(
            action,
            this.neighborhoodAdmins,
        );
    }

    smash(userDid: DID) {
        return this.setRelationship(userDid, 'smash');
    }

    pass(userDid: DID) {
        return this.setRelationship(userDid, 'pass');
    }

    clear(userDid: DID) {
        return this.setRelationship(userDid, 'clear');
    }

    // TODO: handle for multiple NABs
    discover() {
        return this.neighborhoodAdmins[0].sendMessage(
            SMASH_NBH_DISCOVER_MESSAGE,
        );
    }

    emit(event: string | symbol, ...args: unknown[]): boolean {
        if (event === 'data') {
            const [message, sender] = args as [EncapsulatedIMProtoMessage, DID];
            this.handleMessage(sender, message);
        }
        return super.emit(event, ...args);
    }

    async handleMessage(sender: DID, message: EncapsulatedIMProtoMessage) {
        const nabDid = await DIDResolver.resolve(sender);
        switch (message.type) {
            case 'com.smashchats.profiles':
                if (this.neighborhoodAdminIDs.includes(nabDid.id)) {
                    this.emit(
                        'nbh_profiles',
                        sender,
                        message.data as SmashProfileList,
                    );
                }
                break;
        }
    }
}
