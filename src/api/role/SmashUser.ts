import { SmashMessaging } from '@src/api/SmashMessaging.js';
import { DIDManager } from '@src/core/identity/did/DIDManager.js';
import type { SmashPeer } from '@src/core/messaging/peer/SmashPeer.js';
import {
    SMASH_NBH_DISCOVER_MESSAGE,
    SMASH_NBH_JOIN_MESSAGE,
} from '@src/shared/constants/messages.js';
import {
    NBH_ADDED,
    NBH_PROFILE_LIST,
    type Relationship,
    SMASH_PROFILE_LIST,
} from '@src/shared/lexicon/smashchats.lexicon.js';
import type { SmashActionJson } from '@src/shared/types/action.types.js';
import type { DID, DIDString } from '@src/shared/types/did.types.js';
import type { SmashProfileList } from '@src/shared/types/smash.types.js';

declare module '@src/shared/events/MessagingEventMap.js' {
    interface MessagingEventMap {
        [NBH_ADDED]: [DIDString];
        [NBH_PROFILE_LIST]: [DIDString, SmashProfileList];
    }
}

/**
 * A user that aims to join Smash neighborhoods and interact with other users.
 * @public
 */
export class SmashUser extends SmashMessaging {
    private readonly neighborhoodAdmins = new Map<string, SmashPeer>();

    public async join(joinAction: SmashActionJson) {
        await this.connectToSMEEndpoints(joinAction);
        await this.joinNeighborhood(joinAction.did);
    }

    private async connectToSMEEndpoints(joinAction: SmashActionJson) {
        if (!joinAction.config?.sme?.length) return;

        await Promise.all(
            joinAction.config.sme.map(async (smeConfig) => {
                const didManager = DIDManager.get(
                    DIDManager.parseMethod(this.did),
                );
                if (!didManager) {
                    throw new Error(
                        'no DID manager found, cannot generate prekey pair',
                    );
                }
                const preKeyPair = await didManager.generateNewPreKeyPair(
                    this.identity,
                );
                await this.endpoints.connect(smeConfig, preKeyPair);
            }),
        );

        this.logger.debug(
            `Connected to ${joinAction.config.sme.length} endpoints configured by join action config.`,
        );
    }

    private async joinNeighborhood(nabDid: DID) {
        const nabPeer = await this.peers.getOrCreate(nabDid);
        await nabPeer.send(SMASH_NBH_JOIN_MESSAGE);

        this.neighborhoodAdmins.set(nabPeer.id, nabPeer);
        this.emit(NBH_ADDED, nabPeer.id);
    }

    private async setRelationship(userDid: DID, action: Relationship) {
        const peer = await this.peers.getOrCreate(userDid);
        peer.setRelationship(
            action,
            Array.from(this.neighborhoodAdmins.values()),
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

    public async discover() {
        // TODO: handle for multiple NABs
        const firstNab = this.neighborhoodAdmins.values().next().value;
        if (firstNab) {
            await firstNab.send(SMASH_NBH_DISCOVER_MESSAGE);
        }
    }

    constructor(...args: ConstructorParameters<typeof SmashMessaging>) {
        super(...args);
        this.initializeProfileListHandler();
    }

    private initializeProfileListHandler() {
        this.on(SMASH_PROFILE_LIST, (did, message) => {
            this.logger.debug(`onProfileList ${did} ${message.sha256}`);
            if (this.neighborhoodAdmins.has(did)) {
                this.emit(
                    NBH_PROFILE_LIST,
                    did,
                    message.data as SmashProfileList,
                );
            }
        });
    }
}
