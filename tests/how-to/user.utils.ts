import { SME_PUBLIC_KEY } from '@tests/jest.global.js';
import {
    DIDDocManager,
    DIDDocument,
    IMPeerIdentity,
    SmashMessaging,
} from 'smash-node-lib';

export interface TestPeer {
    messaging: SmashMessaging;
    did: DIDDocument;
    onData: jest.Mock;
    onStatus: jest.Mock;
}

export const createPeer = async (
    name: string,
    serverUrl?: string | string[],
    loadIdentity?: IMPeerIdentity,
    didDocManager = new DIDDocManager(),
): Promise<TestPeer> => {
    const identity = loadIdentity ?? (await didDocManager.generate());
    const config = serverUrl
        ? (Array.isArray(serverUrl) ? serverUrl : [serverUrl]).map((url) => ({
              url,
              smePublicKey: SME_PUBLIC_KEY,
          }))
        : [];
    const messaging = new SmashMessaging(identity, name, 'DEBUG');
    await messaging.endpoints.connect(config);

    const did = await messaging.getDIDDocument();
    const onData = jest.fn();
    const onStatus = jest.fn();

    messaging.on('data', onData);
    messaging.on('status', onStatus);

    return { messaging, did, onData, onStatus };
};
