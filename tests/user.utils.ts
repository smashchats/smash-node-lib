import { Identity } from '2key-ratchet';
import { SMEConfigJSONWithoutDefaults, SmashMessaging } from 'smash-node-lib';

export async function peerArgs(
    socketServerUrl?: string,
): Promise<[Identity, SMEConfigJSONWithoutDefaults[]]> {
    const identity = await SmashMessaging.generateIdentity();
    const config = socketServerUrl
        ? [
              {
                  url: socketServerUrl,
                  smePublicKey: 'smePublicKey==',
              },
          ]
        : [];
    return [identity, config];
}
