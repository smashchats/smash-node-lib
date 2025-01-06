import type { ECPublicKey, IECKeyPair } from '2key-ratchet';
import { solveChallenge } from '@src/api/tools/solveChallenge.js';
import { KeyUtils } from '@src/core/crypto/utils/KeyUtils.js';
import { SigningUtils } from '@src/core/crypto/utils/SigningUtils.js';
import type { SessionManager } from '@src/core/messaging/session/SessionManager.js';
import { SMESocketWriteOnly } from '@src/infrastructure/network/sme/SMESocketWriteOnly.js';
import { SME_DEFAULT_CONFIG } from '@src/shared/constants/sme.js';
import type { onMessagesStatusFn } from '@src/shared/types/callbacks.types.js';
import type {
    SMEConfig,
    SMEConfigJSONWithoutDefaults,
    SmashEndpoint,
} from '@src/shared/types/sme.types.js';
import type { Logger } from '@src/shared/utils/Logger.js';

export class SMESocketReadWrite extends SMESocketWriteOnly {
    constructor(
        logger: Logger,
        url: string,
        onMessagesStatusCallback: onMessagesStatusFn,
        private readonly sessionManager: SessionManager,
    ) {
        super(logger, url, onMessagesStatusCallback);
    }

    public async initSocketWithAuth(
        signingKey: IECKeyPair,
        preKeyPair: IECKeyPair,
        smeConfig: SMEConfigJSONWithoutDefaults,
    ): Promise<SmashEndpoint> {
        this.logger.debug(`SMESocketReadWrite::initSocketWithAuth with auth`);
        const auth = this.createAuthConfig(smeConfig, preKeyPair);
        return this.setupAuthenticatedSocket(signingKey, auth);
    }

    private createAuthConfig(
        smeConfig: SMEConfigJSONWithoutDefaults,
        preKeyPair: IECKeyPair,
    ): SMEConfig {
        return {
            ...SME_DEFAULT_CONFIG,
            ...Object.fromEntries(
                Object.entries(smeConfig).filter(([, v]) => v !== undefined),
            ),
            smePublicKey: smeConfig.smePublicKey,
            url: smeConfig.url,
            preKeyPair,
        };
    }

    private async setupAuthenticatedSocket(
        signingKey: IECKeyPair,
        auth: SMEConfig,
    ): Promise<SmashEndpoint> {
        const [exportedPreKey, signature] = await this.generateAuthCredentials(
            signingKey,
            auth.preKeyPair.publicKey,
        );

        const authParams = {
            key: exportedPreKey,
            keyAlgorithm: auth.keyAlgorithm,
        };

        this.initializeSocket(authParams);
        return this.handleSocketAuthentication(auth, exportedPreKey, signature);
    }

    private async generateAuthCredentials(
        signingKey: IECKeyPair,
        preKeyPublicKey: ECPublicKey,
    ): Promise<[string, string]> {
        return Promise.all([
            KeyUtils.encodeKeyAsString(preKeyPublicKey.key),
            SigningUtils.signAsString(
                signingKey.privateKey,
                preKeyPublicKey.serialize(),
            ),
        ]);
    }

    private initializeSocket(authParams: {
        key: string;
        keyAlgorithm: KeyAlgorithm;
    }): void {
        this.logger.debug('authParams', JSON.stringify(authParams, null, 2));
        this.initSocket(authParams);

        if (!this.socket) {
            this.logger.error('> SME socket not initialized');
            throw new Error('> SME socket not initialized');
        }
    }

    private handleSocketAuthentication(
        auth: SMEConfig,
        exportedPreKey: string,
        signature: string,
    ): Promise<SmashEndpoint> {
        return new Promise<SmashEndpoint>((resolve, reject) => {
            if (!this.socket) {
                reject(new Error('Socket not initialized'));
                return;
            }

            this.setupChallengeHandler(
                auth,
                exportedPreKey,
                signature,
                resolve,
                reject,
            );
            this.setupDataHandler();
        });
    }

    private setupChallengeHandler(
        auth: SMEConfig,
        exportedPreKey: string,
        signature: string,
        resolve: (value: SmashEndpoint) => void,
        reject: (reason?: unknown) => void,
    ): void {
        this.socket!.on('challenge', async (data) => {
            this.logger.debug('SMESocketReadWrite::challenge');
            try {
                await this.handleChallenge(
                    data,
                    auth,
                    exportedPreKey,
                    signature,
                    resolve,
                );
            } catch (err) {
                this.logger.error(
                    'Cannot solve challenge.',
                    err instanceof Error ? err.message : err,
                );
                reject(err);
            }
        });
    }

    private async handleChallenge(
        data: { challenge: string; iv: string },
        auth: SMEConfig,
        exportedPreKey: string,
        signature: string,
        resolve: (value: SmashEndpoint) => void,
    ): Promise<void> {
        const solvedChallenge = await solveChallenge(data, auth);
        this.logger.debug(
            `> SME Challenge (${data.challenge}) -> (${solvedChallenge})`,
        );

        if (!this.isSocketConnected()) {
            throw new Error('> SME socket not connected');
        }

        this.socket!.emit('register', solvedChallenge, () => {
            this.logger.debug('> SME Challenge SOLVED');
            resolve({
                url: auth.url,
                preKey: exportedPreKey,
                signature,
            });
        });
    }

    private isSocketConnected(): boolean {
        return (
            this.socket !== undefined &&
            !this.socket.disconnected &&
            this.socket.connected
        );
    }

    private setupDataHandler(): void {
        this.socket!.on('data', (sessionId: string, data: ArrayBuffer) => {
            this.sessionManager.incomingData(sessionId, data);
        });
    }
}
