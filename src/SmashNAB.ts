import { SmashMessaging } from '@src/SmashMessaging.js';
import {
    DID,
    EncapsulatedIMProtoMessage,
    IMProfile,
    JoinAction,
    SMEConfigJSONWithoutDefaults,
    SME_DEFAULT_CONFIG,
    SmashChatRelationshipData,
} from '@src/types/index.js';

export class SmashNAB extends SmashMessaging {
    async getJoinInfo(
        smeConfig?: SMEConfigJSONWithoutDefaults[],
    ): Promise<JoinAction> {
        const did = await this.getDID();
        const joinInfo = {
            action: 'join',
            did,
        } as JoinAction;
        if (smeConfig?.length) {
            joinInfo.config = {
                sme: smeConfig.map((config) =>
                    SmashNAB.getDiffFromDefault(config),
                ),
            };
        }
        return joinInfo;
    }

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

    emit(event: string | symbol, ...args: unknown[]): boolean {
        const result = super.emit(event, ...args);
        if (event === 'data') {
            const [message, sender] = args as [EncapsulatedIMProtoMessage, DID];
            this.handleMessage(sender, message);
        }
        return result;
    }

    handleMessage(sender: DID, message: EncapsulatedIMProtoMessage) {
        switch (message.type) {
            case 'com.smashchats.nbh.join':
                // TODO: join config specific to nab (totp, past relationships, etc)
                this.emit('join', sender);
                break;
            case 'com.smashchats.nbh.discover':
                this.emit('discover', sender);
                break;
            case 'com.smashchats.relationship':
                // TODO: shall we pass the encapsulation info down the lib
                // TODO: in other words, is there a reason for this middleware???
                this.emit(
                    'action',
                    sender,
                    message.data as SmashChatRelationshipData,
                    new Date(message.timestamp),
                );
                break;
            case 'org.improto.profile':
                this.emit('profile', sender, message.data as IMProfile);
                break;
        }
    }
}
