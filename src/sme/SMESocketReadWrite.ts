import { SME_DEFAULT_CONFIG } from '@src/const.js';
import { SessionManager } from '@src/signal/index.js';
import { SMESocketWriteOnly } from '@src/sme/SMESocketWriteOnly.js';
import {
    IECKeyPair,
    SMEConfig,
    SMEConfigJSONWithoutDefaults,
    SmashEndpoint,
    onMessagesStatusFn,
} from '@src/types/index.js';
import { CryptoUtils, Logger } from '@src/utils/index.js';

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
        this.logger.debug('SMESocketReadWrite::initSocketWithAuth');
        const auth = {
            ...SME_DEFAULT_CONFIG,
            ...smeConfig,
            preKeyPair,
        } as SMEConfig;
        return new Promise<SmashEndpoint>((resolve, reject) => {
            const preKeyPublicKey = auth.preKeyPair.publicKey;
            Promise.all([
                CryptoUtils.singleton.exportKey(preKeyPublicKey.key),
                CryptoUtils.singleton.signAsString(
                    signingKey.privateKey,
                    auth.preKeyPair.publicKey.serialize(),
                ),
            ]).then(([exportedPreKey, signature]) => {
                // we initialize a new socket with given auth params
                this.initSocket({
                    key: exportedPreKey,
                    keyAlgorithm: auth.keyAlgorithm,
                });
                if (!this.socket) {
                    this.logger.error('> SME socket not initialized');
                    throw new Error('> SME socket not initialized');
                }
                // TODO timeout
                this.socket.on('challenge', async (data) => {
                    this.logger.debug('SMESocketReadWrite::challenge');
                    try {
                        const solvedChallenge =
                            await CryptoUtils.singleton.solveChallenge(
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
