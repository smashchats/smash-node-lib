import { DID, SMEConfigJSONWithoutDefaults } from '@src/types/index.js';

export interface SmashActionJson {
    did: DID;
    action: 'join';
    config?: {
        // TODO SME credentials/usage restrictions/auth
        sme?: SMEConfigJSONWithoutDefaults[];
    };
}

export interface JoinAction extends SmashActionJson {
    action: 'join';
}
