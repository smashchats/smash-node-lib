import {
    DID,
    SMASH_NBH_JOIN,
    SMEConfigJSONWithoutDefaults,
} from '@src/types/index.js';

export interface SmashActionJson {
    did: DID;
    action: typeof SMASH_NBH_JOIN;
    config?: {
        // TODO SME credentials/usage restrictions/auth
        sme?: SMEConfigJSONWithoutDefaults[];
    };
}
