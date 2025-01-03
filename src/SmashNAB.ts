import { SmashMessaging } from '@src/SmashMessaging.js';
import { SmashPeer } from '@src/SmashPeer.js';
import { SME_DEFAULT_CONFIG } from '@src/const.js';
import { SmashActionJson } from '@src/types/action.types.js';
import { DIDDocument, DIDString } from '@src/types/did.types.js';
import { ISO8601, sha256 } from '@src/types/message.types.js';
import { SmashProfileList } from '@src/types/smash.types.js';
import {
    Relationship,
    SMASH_NBH_DISCOVER,
    SMASH_NBH_JOIN,
    SMASH_NBH_RELATIONSHIP,
    SMASH_PROFILE_LIST,
    SmashChatDiscoverMessage,
    SmashChatJoinMessage,
    SmashChatRelationshipMessage,
} from '@src/types/smashchats.lexicon.js';
import { SMEConfigJSONWithoutDefaults } from '@src/types/sme.types.js';

/**
 * Abstract base class for implementing a Neighborhood Admin Bot (NAB)
 * Handles neighborhood membership, discovery, and relationships between peers
 */
export abstract class SmashNAB extends SmashMessaging {
    /**
     * Gets the non-default SME config values
     */
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

    /**
     * Generates join info for new neighborhood members
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

    constructor(...args: ConstructorParameters<typeof SmashMessaging>) {
        super(...args);
        this.setupEventHandlers();
    }

    /**
     * Set up event handlers for NAB messages
     */
    private setupEventHandlers(): void {
        this.on(SMASH_NBH_JOIN, this.handleJoin.bind(this));
        this.on(SMASH_NBH_DISCOVER, this.handleDiscover.bind(this));
        this.on(SMASH_NBH_RELATIONSHIP, this.handleRelationship.bind(this));
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
        peer?: SmashPeer,
    ): Promise<void> {
        const discovered = await this.onDiscover(
            did,
            message.sha256,
            message.timestamp,
        );

        await peer?.send({
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
