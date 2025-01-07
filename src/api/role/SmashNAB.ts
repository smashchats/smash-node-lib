import { SmashMessaging } from '@src/api/SmashMessaging.js';
import { SME_DEFAULT_CONFIG } from '@src/shared/constants/sme.js';
import {
    type Relationship,
    SMASH_NBH_DISCOVER,
    SMASH_NBH_JOIN,
    SMASH_NBH_RELATIONSHIP,
    SMASH_PROFILE_LIST,
    type SmashChatDiscoverMessage,
    type SmashChatJoinMessage,
    type SmashChatRelationshipMessage,
} from '@src/shared/lexicon/smashchats.lexicon.js';
import type { SmashActionJson } from '@src/shared/types/action.types.js';
import type { DIDDocument, DIDString } from '@src/shared/types/did.types.js';
import type { SmashProfileList } from '@src/shared/types/smash.types.js';
import type { SMEConfigJSONWithoutDefaults } from '@src/shared/types/sme.types.js';
import type { ISO8601, sha256 } from '@src/shared/types/string.types.js';

/**
 * Abstract base class for implementing a Neighborhood Admin Bot (NAB)
 * Handles neighborhood membership, discovery, and relationships between peers
 * https://dev.smashchats.com/Smash%20Neighborhoods%20(NBH)
 * https://dev.smashchats.com/Neighborhood%20Admin%20Bot%20(NAB)
 * @public
 */
export abstract class SmashNAB extends SmashMessaging {
    /**
     * Generates join info for new neighborhood members
     * https://dev.smashchats.com/join%20procedure
     */
    public async getJoinInfo(
        smeConfigs?: SMEConfigJSONWithoutDefaults[],
    ): Promise<SmashActionJson> {
        const joinInfo: SmashActionJson = {
            action: SMASH_NBH_JOIN,
            did: await this.getDIDDocument(),
        };

        if (smeConfigs?.length) {
            joinInfo.config = {
                sme: smeConfigs.map((config) =>
                    SmashNAB.getCustomSMEConfig(config),
                ),
            };
        }

        return joinInfo;
    }

    /**
     * Handle new member join requests
     * https://dev.smashchats.com/join%20procedure
     * @param didDocument - The DID document of the new member
     * @param messageHash - The SHA-256 hash of the join message
     * @param timestamp - The timestamp of the join message
     */
    public abstract onJoin(
        didDocument: DIDDocument,
        messageHash?: sha256,
        timestamp?: ISO8601,
    ): Promise<void>;

    /**
     * Handle peer discovery requests
     * https://dev.smashchats.com/message%20lexicon
     * @param fromDID - The DID url of the peer that is discovering
     * @param messageHash - The SHA-256 hash of the discover message
     * @param timestamp - The timestamp of the discover message
     */
    public abstract onDiscover(
        fromDID: DIDString,
        messageHash?: sha256,
        timestamp?: ISO8601,
    ): Promise<SmashProfileList>;

    /**
     * Handle relationship updates between peers
     * https://dev.smashchats.com/smash%20or%20pass
     * @param fromDID - The DID url of the peer that is updating the relationship
     * @param toDID - The DID url of the peer that is being updated
     * @param relationship - The relationship to update
     * @param messageHash - The SHA-256 hash of the relationship message
     * @param timestamp - The timestamp of the relationship message
     */
    public abstract onRelationship(
        fromDID: DIDString,
        toDID: DIDString,
        relationship: Relationship,
        messageHash?: sha256,
        timestamp?: ISO8601,
    ): Promise<unknown>;

    /**
     * configure a Neighborhood Admin Bot using the SmashMessaging interface
     * @see SmashMessaging
     * https://dev.smashchats.com/Neighborhood%20Admin%20Bot%20(NAB)
     */
    constructor(...args: ConstructorParameters<typeof SmashMessaging>) {
        super(...args);
        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.on(SMASH_NBH_JOIN, this.handleJoin.bind(this));
        this.on(SMASH_NBH_DISCOVER, this.handleDiscover.bind(this));
        this.on(SMASH_NBH_RELATIONSHIP, this.handleRelationship.bind(this));
    }

    private static getCustomSMEConfig(
        config: SMEConfigJSONWithoutDefaults,
    ): SMEConfigJSONWithoutDefaults {
        const customConfig: SMEConfigJSONWithoutDefaults = {
            url: config.url,
            smePublicKey: config.smePublicKey,
        };
        const requiredKeys = new Set(Object.keys(customConfig));
        const defaultKeys = Object.keys(SME_DEFAULT_CONFIG) as Array<
            keyof typeof SME_DEFAULT_CONFIG
        >;
        for (const key of defaultKeys) {
            if (
                !requiredKeys.has(key) &&
                config[key] !== SME_DEFAULT_CONFIG[key]
            ) {
                customConfig[key] = config[key] as never;
            }
        }
        return customConfig;
    }

    private async handleJoin(
        did: DIDString,
        message: SmashChatJoinMessage,
    ): Promise<void> {
        const didDocument = await SmashMessaging.resolve(did);
        this.logger.debug(
            `Processing join request from ${didDocument.id} (${message.sha256})`,
        );
        await this.onJoin(didDocument, message.sha256, message.timestamp);
    }

    private async handleDiscover(
        did: DIDString,
        message: SmashChatDiscoverMessage,
    ): Promise<void> {
        const discovered = await this.onDiscover(
            did,
            message.sha256,
            message.timestamp,
        );
        await this.peers.get(did)?.send({
            type: SMASH_PROFILE_LIST,
            data: discovered,
            after: '0', // TODO: Implement meaningful 'after' value handling
        });
    }

    private async handleRelationship(
        from: DIDString,
        message: SmashChatRelationshipMessage,
    ): Promise<void> {
        await this.onRelationship(
            from,
            message.data.target,
            message.data.action,
            message.sha256,
            message.timestamp,
        );
    }
}
