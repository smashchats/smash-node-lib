import { Identity } from '2key-ratchet';
import { SMEConfigJSONWithoutDefaults } from 'smash-node-lib';

export async function peerArgs(
    socketServerUrl?: string,
): Promise<[Identity, SMEConfigJSONWithoutDefaults[]]> {
    const identity = await Identity.create(0, 1, 0, false);
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
