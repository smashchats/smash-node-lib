import { SME_PUBLIC_KEY } from '@tests/jest.global.js';
import {
    DIDDocManager,
    DIDDocument,
    DIDManager,
    IMPeerIdentity,
    SmashMessaging,
} from 'smash-node-lib';

export interface TestPeer {
    messaging: SmashMessaging;
    did: DIDDocument;
    onData: jest.Mock;
    onStatus: jest.Mock;
}

const defaultDidManager = new DIDDocManager();
SmashMessaging.use('doc', defaultDidManager);

export const generateIdentity = async (
    didManager: DIDManager = defaultDidManager,
) => {
    return await didManager.generate();
};

export const createPeer = async (
    name: string,
    serverUrl?: string | string[],
    loadIdentity?: IMPeerIdentity,
    didManager?: DIDManager,
): Promise<TestPeer> => {
    const identity = loadIdentity ?? (await generateIdentity(didManager));
    const config = serverUrl
        ? (Array.isArray(serverUrl) ? serverUrl : [serverUrl]).map((url) => ({
              url,
              smePublicKey: SME_PUBLIC_KEY,
          }))
        : [];
    const messaging = new SmashMessaging(identity, name, 'DEBUG');
    for (const endpoint of config) {
        const preKeyPair = await identity.generateNewPreKeyPair();
        await messaging.endpoints.connect(endpoint, preKeyPair);
    }

    const did = await messaging.getDIDDocument();

    // Firehose events
    const onData = jest.fn();
    const onStatus = jest.fn();
    // Status events
    messaging.on('data', onData);
    messaging.on('status', onStatus);
    return { messaging, did, onData, onStatus };
};
