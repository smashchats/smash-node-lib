import { Identity } from '2key-ratchet';
import {
    DIDDocument,
    SMEConfigJSONWithoutDefaults,
    SmashMessaging,
} from 'smash-node-lib';

// @deprecated
export async function peerArgs(
    socketServerUrl?: string,
): Promise<[Identity, SMEConfigJSONWithoutDefaults[]]> {
    const identity = await SmashMessaging.generateIdentity(1, 0, true);
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

export interface TestPeer {
    messaging: SmashMessaging;
    did: DIDDocument;
    onData: jest.Mock;
    onStatus: jest.Mock;
}

export const createPeer = async (
    name: string,
    serverUrl?: string,
    loadIdentity?: Identity,
): Promise<TestPeer> => {
    const identity =
        loadIdentity ?? (await SmashMessaging.generateIdentity(1, 0, true));
    const config = serverUrl
        ? [
              {
                  url: serverUrl,
                  smePublicKey: 'smePublicKey==',
              },
          ]
        : [];
    const messaging = new SmashMessaging(identity, undefined, 'DEBUG', name);
    await messaging.initEndpoints(config);

    const did = await messaging.getDID();
    const onData = jest.fn();
    const onStatus = jest.fn();

    messaging.on('data', onData);
    messaging.on('status', onStatus);

    return { messaging, did, onData, onStatus };
};
