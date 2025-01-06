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
    identity: IMPeerIdentity;
    name: string;
}

export const defaultDidManager = new DIDDocManager();
SmashMessaging.use(defaultDidManager);

export const createPeer = async (
    name: string,
    serverUrl?: string | string[],
    loadIdentity?: IMPeerIdentity,
    didManager = defaultDidManager,
): Promise<TestPeer> => {
    if (!didManager) {
        throw new Error('no DID manager found, cannot generate keys');
    }
    const identity = loadIdentity ?? (await didManager.generate());
    const config = serverUrl
        ? (Array.isArray(serverUrl) ? serverUrl : [serverUrl]).map((url) => ({
              url,
              smePublicKey: SME_PUBLIC_KEY,
          }))
        : [];
    const messaging = new SmashMessaging(identity, name, 'DEBUG');
    for (const endpoint of config) {
        const preKeyPair = await didManager.generateNewPreKeyPair(identity);
        await messaging.endpoints.connect(endpoint, preKeyPair);
    }

    const did = await messaging.getDIDDocument();

    // Firehose events
    const onData = jest.fn();
    const onStatus = jest.fn();
    // Status events
    messaging.on('data', onData);
    messaging.on('status', onStatus);
    return { messaging, did, onData, onStatus, identity, name };
};
