import { ECPublicKey } from '2key-ratchet';
import { SessionManager } from '@src/signal/index.js';
import { SMESocketManager } from '@src/sme/SMESocketManager.js';
import type {
    IECKeyPair,
    SMEConfigJSONWithoutDefaults,
    SmashEndpoint,
} from '@src/types/index.js';
import type { Logger } from '@src/utils/Logger.js';
import { CryptoUtils } from '@src/utils/index.js';

import { IMPeerIdentity } from './IMPeerIdentity.js';

// ASSUMPTION#3: Endpoints can be uniquely identified by their URL.
export class EndpointManager extends Map<string, SmashEndpoint> {
    constructor(
        protected readonly logger: Logger,
        private identity: IMPeerIdentity,
        private smeSocketManager: SMESocketManager,
        private sessionManager: SessionManager,
    ) {
        super();
    }

    /**
     * Add or remove endpoints from the manager.
     * DOES NOT RECONNECT ALREADY-CONNECTED ENDPOINTS.
     * @param endpoints configuration of the endpoints to set (add or keep)
     */
    async reset(
        endpoints: (SmashEndpoint & SMEConfigJSONWithoutDefaults)[],
    ): Promise<void> {
        const endpointsToConnect = endpoints.filter(
            (endpoint) => !super.has(endpoint.url),
        );
        const endpointURLs = new Set(endpoints.map((e) => e.url));
        const endpointsToDisconnect = Array.from(super.keys()).filter(
            (url) => !endpointURLs.has(url),
        );
        this.logger.debug(
            `Set ${endpoints.length} endpoints: ${endpointsToDisconnect.length} to disconnect, ` +
                `${endpointsToConnect.length} to connect (use user.endpoints.connect() to force reconnection)`,
        );
        if (endpointsToDisconnect.length) {
            this.logger.debug(
                `> Disconnecting endpoints: ${endpointsToDisconnect.join(', ')}`,
            );
            await Promise.allSettled(
                endpointsToDisconnect.map((url) =>
                    this.remove(super.get(url)!),
                ),
            );
        }
        if (endpointsToConnect.length) {
            const prekeyPair = this.identity.signedPreKeys[0];
            if (!prekeyPair) {
                throw new Error('No prekey pair found');
            }
            const initResults = await Promise.allSettled(
                endpointsToConnect.map((smeConfig) =>
                    this.connect(smeConfig, prekeyPair, true, false),
                ),
            );
            await this.handleFailedConnections(initResults);
        }
    }

    /**
     * Connects to an endpoint (new or re-newed)
     * @param endpointConfig publicly propagated information about this endpoint
     * @param smeConfig configuration on how to authenticate to this endpoint
     * @param updateIdentity whether to update the local identity with the new endpoint
     * @param updateDID whether to update the propagated DID document with the new endpoint
     */
    async connect(
        smeConfig: Partial<SmashEndpoint> & SMEConfigJSONWithoutDefaults,
        prekeyPair: IECKeyPair,
        updateIdentity: boolean = true,
        updateDID: boolean = true,
    ): Promise<SmashEndpoint> {
        let endpointUrl: string;
        if (updateDID) {
            // TODO: implement DID endpoint propagation
            this.logger.warn('DID endpoint propagation is not implemented yet');
        }
        const signingKey = this.identity.signingKey;
        if ('preKey' in smeConfig) {
            if (!('signature' in smeConfig)) {
                throw new Error(
                    `Signature is required when preKey is specified (${smeConfig.url}, ${smeConfig.preKey})`,
                );
            }
            await EndpointManager.validateEndpoint(
                smeConfig.preKey!,
                smeConfig.signature!,
                prekeyPair,
                signingKey,
            );
            endpointUrl = smeConfig.url;
        } else {
            endpointUrl = smeConfig.url;
        }
        this.logger.debug(`Connecting to endpoint ${endpointUrl}...`);
        const connectedEndpoint = await this.smeSocketManager.initWithAuth(
            endpointUrl,
            smeConfig,
            signingKey,
            prekeyPair,
            this.sessionManager,
        );
        super.set(connectedEndpoint.url, connectedEndpoint);
        if (updateIdentity) {
            this.identity.pushEndpoint(connectedEndpoint);
        }
        return connectedEndpoint;
    }

    private async remove(endpoint: SmashEndpoint): Promise<boolean> {
        this.logger.debug(`Disconnecting+removing endpoint ${endpoint.url}...`);
        await this.smeSocketManager.close(endpoint.url);
        this.identity.removeEndpointIfExists(endpoint);
        return super.delete(endpoint.url);
    }

    private async handleFailedConnections(
        results: PromiseSettledResult<SmashEndpoint>[],
    ): Promise<void> {
        const failedConnections = results.filter(
            (r) => r.status === 'rejected',
        ) as PromiseRejectedResult[];
        if (failedConnections.length) {
            const errors = failedConnections.map((r) => r.reason).join(', ');
            this.logger.warn(`Failed to initialize some endpoints: ${errors}`);
        }
    }

    private static async validateEndpoint(
        preKey: string,
        signature: string,
        signedPrekey: IECKeyPair,
        signingKey: IECKeyPair,
    ): Promise<void> {
        const cryptoSingleton = CryptoUtils.singleton;
        const [preKeyThumbprint, signedPrekeyThumbprint] = await Promise.all([
            cryptoSingleton
                .importExchangePublicKey(preKey)
                .then((k) => ECPublicKey.create(k))
                .then((k) => k.thumbprint()),
            signedPrekey.publicKey.thumbprint(),
        ]);
        if (preKeyThumbprint !== signedPrekeyThumbprint) {
            throw new Error(
                'Propagated PreKey does not match provided Signed PreKey',
            );
        }
        const isValidSignature = await cryptoSingleton.verifyOwnedKey(
            signingKey.publicKey,
            signedPrekey.publicKey,
            cryptoSingleton.stringToBuffer(signature!),
        );
        if (!isValidSignature) {
            throw new Error('Invalid PreKey signature');
        }
    }
}
