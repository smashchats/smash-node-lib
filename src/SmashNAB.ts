import SmashMessaging from '@src/SmashMessaging.js';
import {
    ActionSmashMessage,
    EncapsulatedSmashMessage,
    JoinAction,
    SMEConfigJSONWithoutDefaults,
    SME_DEFAULT_CONFIG,
    SmashDID,
} from '@src/types/index.js';

type ActionMessage = EncapsulatedSmashMessage & ActionSmashMessage;

export default class SmashNAB extends SmashMessaging {
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
                diff[key as default_keys] = value as any;
        }
        return diff as SMEConfigJSONWithoutDefaults;
    }

    emit(event: string | symbol, ...args: any[]): boolean {
        const result = super.emit(event, ...args);
        if (event === 'message') {
            const [message, sender] = args as [
                EncapsulatedSmashMessage,
                SmashDID,
            ];
            this.handleMessage(sender, message);
        }
        return result;
    }

    handleMessage(sender: SmashDID, message: EncapsulatedSmashMessage) {
        switch (message.type) {
            case 'join':
                // TODO: join config specific to nab (totp, past relationships, etc)
                this.emit('join', sender, message.data as {});
                break;
            case 'text':
                this.emit('text', sender, message.data as string);
                break;
            case 'action':
                this.handleAction(sender, message as ActionMessage);
                break;
        }
    }

    // TODO: implement relationship persistence and time-relative update (local graph)
    handleAction(sender: SmashDID, message: ActionMessage) {
        this.emit('action', sender, message.data);
    }
}
