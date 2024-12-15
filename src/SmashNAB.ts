import { SmashMessaging } from '@src/SmashMessaging.js';
import {
    DataForwardingResolver,
    NeverResolver,
    SenderDIDDocumentResolver,
} from '@src/callbacks/index.js';
import {
    DIDDocument,
    DIDString,
    ISO8601,
    SMASH_NBH_DISCOVER,
    SMASH_NBH_JOIN,
    SMASH_NBH_RELATIONSHIP,
    SMEConfigJSONWithoutDefaults,
    SME_DEFAULT_CONFIG,
    SmashActionJson,
    SmashChatRelationshipData,
    SmashChatRelationshipMessage,
    sha256,
} from '@src/types/index.js';

export abstract class SmashNAB extends SmashMessaging {
    private static getDiffFromDefault(config: SMEConfigJSONWithoutDefaults) {
        // Copy mandatory keys
        const diff: SMEConfigJSONWithoutDefaults = {
            url: config.url,
            smePublicKey: config.smePublicKey,
        };
        const mandatory_keys = Object.keys(diff);
        // Copy non-default values for other keys
        type default_keys = keyof typeof SME_DEFAULT_CONFIG;
        for (const [key, value] of Object.entries(config)) {
            if (
                !mandatory_keys.includes(key) &&
                value !== SME_DEFAULT_CONFIG[key as default_keys]
            )
                diff[key as default_keys] = value as never;
        }
        return diff as SMEConfigJSONWithoutDefaults;
    }

    public async getJoinInfo(
        smeConfig?: SMEConfigJSONWithoutDefaults[],
    ): Promise<SmashActionJson> {
        const did = await this.getDID();
        const joinInfo = {
            action: SMASH_NBH_JOIN,
            did,
        } as SmashActionJson;
        if (smeConfig?.length) {
            joinInfo.config = {
                sme: smeConfig.map((config) =>
                    SmashNAB.getDiffFromDefault(config),
                ),
            };
        }
        return joinInfo;
    }

    public abstract onJoin(
        from: DIDString,
        did: DIDDocument,
        sha256?: sha256,
        timeString?: ISO8601,
    ): Promise<unknown>;
    public abstract onDiscover(
        from: DIDString,
        sha256?: sha256,
        timeString?: ISO8601,
    ): Promise<unknown>;
    public abstract onRelationship(
        from: DIDString,
        { target, action }: SmashChatRelationshipData,
        sha256?: sha256,
        timeString?: ISO8601,
    ): Promise<unknown>;

    constructor(...args: ConstructorParameters<typeof SmashMessaging>) {
        super(...args);
    }

    /**
     * Register all hooks for the NAB
     * - Join: Handle join event
     * - Discover: Handle discover event
     * - Relationship: Handle relationship event
     */
    public registerHooks() {
        this.registerJoin();
        this.registerDiscover();
        this.registerRelationship();
    }

    private registerRelationship() {
        this.superRegister(
            SMASH_NBH_RELATIONSHIP,
            new DataForwardingResolver<SmashChatRelationshipMessage>(
                SMASH_NBH_RELATIONSHIP,
            ),
        );
        this.on(SMASH_NBH_RELATIONSHIP, this.onRelationship.bind(this));
    }

    private registerJoin() {
        this.superRegister(
            SMASH_NBH_JOIN,
            new SenderDIDDocumentResolver(SMASH_NBH_JOIN),
        );
        this.on(SMASH_NBH_JOIN, this.onJoin.bind(this));
    }

    private registerDiscover() {
        // TODO: Never
        this.superRegister(
            SMASH_NBH_DISCOVER,
            new NeverResolver(SMASH_NBH_DISCOVER),
        );
        this.on(SMASH_NBH_DISCOVER, this.onDiscover.bind(this));
    }
}
