import { SME_PUBLIC_KEY } from '@tests/vitest.sme-server.js';
import {
    DIDDocManager,
    DIDDocument,
    IMPeerIdentity,
    Logger,
    SmashEndpoint,
    SmashMessaging,
} from 'smash-node-lib';
import { vi } from 'vitest';

import { TEST_CONFIG, delay } from './time.utils.js';

export interface TestPeer {
    messaging: SmashMessaging;
    did: DIDDocument;
    onData: ReturnType<typeof vi.fn>;
    onStatus: ReturnType<typeof vi.fn>;
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
    const onData = vi.fn();
    const onStatus = vi.fn();
    // Status events
    messaging.on('data', onData);
    messaging.on('status', onStatus);
    return { messaging, did, onData, onStatus, identity, name };
};

// TODO: import config on lib loading (& add to tutorial)
export const stopTestPeer = async (logger: Logger, peer: TestPeer) => {
    logger.debug('>> Exporting peer identity');
    const peerExportedIdentity = await peer.messaging.exportIdentity();
    logger.debug('> Exported', JSON.stringify(peerExportedIdentity, null, 2));

    const oldEndpoints = [...peer.did.endpoints];

    logger.debug('>> Closing peer messaging');
    await peer.messaging.close();
    await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);

    return { peerExportedIdentity, oldEndpoints };
};

export const startTestPeer = async (
    logger: Logger,
    peerName: string,
    peerExportedIdentity: string,
    oldEndpoints: SmashEndpoint[],
) => {
    logger.debug('>> Importing peer identity');
    const peerIdentity = await SmashMessaging.importIdentity(
        JSON.parse(peerExportedIdentity),
    );
    logger.debug(
        '> Imported',
        JSON.stringify(await peerIdentity.serialize(), null, 2),
    );

    logger.debug('>> Creating restarted peer');
    const restartedPeer = await createPeer(
        `${peerName} (after restart)`,
        [],
        peerIdentity,
    );
    const peerEndpointsReconfig = oldEndpoints.map((endpoint, index) => ({
        ...endpoint,
        smePublicKey: SME_PUBLIC_KEY,
        preKeyPair: peerIdentity.signedPreKeys[index],
    }));
    await restartedPeer.messaging.endpoints.reset(peerEndpointsReconfig);
    return restartedPeer;
};

export const restartTestPeer = async (logger: Logger, peer: TestPeer) => {
    const { peerExportedIdentity, oldEndpoints } = await stopTestPeer(
        logger,
        peer,
    );
    return await startTestPeer(
        logger,
        peer.name,
        peerExportedIdentity,
        oldEndpoints,
    );
};
