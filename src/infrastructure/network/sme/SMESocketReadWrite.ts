import type { IECKeyPair } from '2key-ratchet';
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
        const auth: SMEConfig = {
            ...SME_DEFAULT_CONFIG,
            ...Object.fromEntries(
                Object.entries(smeConfig).filter(([, v]) => v !== undefined),
            ),
            smePublicKey: smeConfig.smePublicKey,
            url: smeConfig.url,
            preKeyPair,
        };
        return new Promise<SmashEndpoint>((resolve, reject) => {
            const preKeyPublicKey = auth.preKeyPair.publicKey;
            Promise.all([
                KeyUtils.encodeKeyAsString(preKeyPublicKey.key),
                SigningUtils.signAsString(
                    signingKey.privateKey,
                    auth.preKeyPair.publicKey.serialize(),
                ),
            ]).then(([exportedPreKey, signature]) => {
                // we initialize a new socket with given auth params
                const authParams = {
                    key: exportedPreKey,
                    keyAlgorithm: auth.keyAlgorithm,
                };
                this.logger.debug(
                    'authParams',
                    JSON.stringify(authParams, null, 2),
                );
                this.initSocket(authParams);
                if (!this.socket) {
                    this.logger.error('> SME socket not initialized');
                    throw new Error('> SME socket not initialized');
                }
                // TODO timeout
                this.socket.on('challenge', async (data) => {
                    this.logger.debug('SMESocketReadWrite::challenge');
                    try {
                        const solvedChallenge = await solveChallenge(
                            data,
                            auth,
                        );
                        this.logger.debug(
                            `> SME Challenge (${data.challenge}) -> (${solvedChallenge})`,
                        );
                        if (
                            !this.socket ||
                            this.socket.disconnected ||
                            !this.socket.connected
                        ) {
                            this.logger.error('> SME socket not connected');
                            throw new Error('> SME socket not connected');
                        }
                        this.socket.emit('register', solvedChallenge, () => {
                            this.logger.debug('> SME Challenge SOLVED');
                            resolve({
                                url: auth.url,
                                preKey: exportedPreKey,
                                signature,
                            });
                        });
                    } catch (err) {
                        this.logger.error(
                            'Cannot solve challenge.',
                            err instanceof Error ? err.message : err,
                        );
                        reject(err);
                    }
                });
                this.socket.on(
                    'data',
                    (sessionId: string, data: ArrayBuffer) => {
                        this.sessionManager.incomingData(sessionId, data);
                    },
                );
            });
        });
    }
}
