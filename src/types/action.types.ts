import { SmashDID } from '@src/types/did.types.js';
import { SMEConfigJSONWithoutDefaults } from '@src/types/sme.types.js';

export interface SmashActionJson {
    // TODO: using full DID until we have a DID resolver
    did: SmashDID;
    action: 'join';
    config?: {
        // TODO SME credentials/usage restrictions/auth
        sme?: SMEConfigJSONWithoutDefaults[];
    };
}

export interface JoinAction extends SmashActionJson {
    action: 'join';
}
