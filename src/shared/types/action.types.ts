import type { SMASH_NBH_JOIN } from '@src/shared/lexicon/smashchats.lexicon.js';
import type { DID } from '@src/shared/types/did.types.js';
import type { SMEConfigJSONWithoutDefaults } from '@src/shared/types/sme.types.js';

export interface SmashActionJson {
    did: DID;
    action: typeof SMASH_NBH_JOIN;
    config?: {
        // TODO SME credentials/usage restrictions/auth
        sme?: SMEConfigJSONWithoutDefaults[];
    };
}
