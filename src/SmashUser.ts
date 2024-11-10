import SmashMessaging from '@src/SmashMessaging.js';
import { SmashPeer } from '@src/SmashPeer.js';
import { SmashDID } from '@src/types/did.types.js';
import {
    EncapsulatedSmashMessage,
    JoinAction,
    Relationship,
} from '@src/types/index.js';

export default class SmashUser extends SmashMessaging {
    private neighborhoodAdminIDs: string[] = [];
    private neighborhoodAdmins: SmashPeer[] = [];

    async join(joinAction: JoinAction) {
        // Initialize endpoints if SME config is provided
        if (joinAction.config?.sme) {
            await this.initEndpoints(joinAction.config.sme);
        }
        // Create or get NAB peer and send join message
        const nabPeer = await this.getOrCreatePeer(joinAction.did);
        await nabPeer.sendMessage({ type: 'join', data: {} });
        // Add neighborhood admin (NAB) and emit user event
        const nabDid = nabPeer.getDID();
        this.neighborhoodAdminIDs.push(nabDid.id);
        this.neighborhoodAdmins.push(nabPeer);
        this.emit('nbh_added', nabDid);
    }

    private async setRelationship(userDid: SmashDID, action: Relationship) {
        (await this.getOrCreatePeer(userDid)).setRelationship(
            action,
            this.neighborhoodAdmins,
        );
    }

    smash(userDid: SmashDID) {
        return this.setRelationship(userDid, 'smash');
    }

    pass(userDid: SmashDID) {
        return this.setRelationship(userDid, 'pass');
    }

    clear(userDid: SmashDID) {
        return this.setRelationship(userDid, 'clear');
    }

    // TODO: handle for multiple NABs
    discover() {
        return this.neighborhoodAdmins[0].sendMessage({
            type: 'discover',
            data: {},
        });
    }

    emit(event: string | symbol, ...args: any[]): boolean {
        if (event === 'message') {
            const [message, sender] = args as [
                EncapsulatedSmashMessage,
                SmashDID,
            ];
            this.handleMessage(sender, message);
        }
        return super.emit(event, ...args);
    }

    handleMessage(sender: SmashDID, message: EncapsulatedSmashMessage) {
        switch (message.type) {
            case 'profiles':
                if (this.neighborhoodAdminIDs.includes(sender.id)) {
                    this.emit('nbh_profiles', sender, message.data as {});
                }
                break;
        }
    }
}
