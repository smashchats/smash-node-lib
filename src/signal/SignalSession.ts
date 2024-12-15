import {
    AsymmetricRatchet,
    ECPublicKey,
    MessageSignedProtocol,
    PreKeyBundleProtocol,
    PreKeyMessageProtocol,
} from '2key-ratchet';
import { EXPIRATION_TIME_MS } from '@src/const.js';
import {
    DIDDocument,
    EncapsulatedIMProtoMessage,
    Identity,
    SmashEndpoint,
} from '@src/types/index.js';
import { CryptoUtils, Logger } from '@src/utils/index.js';

export class SignalSession {
    public readonly createdAtTime: number;
    public static readonly SESSION_TTL_MS = EXPIRATION_TIME_MS;

    constructor(
        public readonly id: string,
        private readonly cipher: AsymmetricRatchet,
        public readonly peerIk: string,
        private readonly logger: Logger,
    ) {
        this.createdAtTime = Date.now();
    }

    isExpired(): boolean {
        return Date.now() - this.createdAtTime > SignalSession.SESSION_TTL_MS;
    }

    static async create(
        peerDidDocument: DIDDocument,
        identity: Identity,
        sme: SmashEndpoint,
        logger: Logger,
    ) {
        try {
            const bundle = new PreKeyBundleProtocol();
            bundle.registrationId = 0; // warning: using fixed value, unsure about usage!
            bundle.identity.signingKey = await ECPublicKey.create(
                await CryptoUtils.singleton.importKey(peerDidDocument.ik),
            );
            bundle.identity.exchangeKey = await ECPublicKey.create(
                await CryptoUtils.singleton.importKey(peerDidDocument.ek),
            );
            bundle.identity.signature = CryptoUtils.singleton.stringToBuffer(
                peerDidDocument.signature,
            );

            bundle.preKeySigned.id = 0; // warning: using fixed value, unsure about usage!
            bundle.preKeySigned.key = await ECPublicKey.create(
                await CryptoUtils.singleton.importKey(sme.preKey),
            );
            bundle.preKeySigned.signature =
                CryptoUtils.singleton.stringToBuffer(sme.signature);

            const protocol = await PreKeyBundleProtocol.importProto(bundle);
            const cipher = await AsymmetricRatchet.create(identity, protocol);

            const sessionId = await CryptoUtils.singleton.keySha256(
                cipher.currentRatchetKey.publicKey.key,
            );
            return new SignalSession(
                sessionId,
                cipher,
                peerDidDocument.ik,
                logger,
            );
        } catch (err) {
            logger.warn('Cannot create session.');
            throw err;
        }
    }

    static async parseSession(
        identity: Identity,
        sessionId: string,
        data: ArrayBuffer,
        logger: Logger,
    ): Promise<[SignalSession, EncapsulatedIMProtoMessage[]]> {
        logger.debug('SignalSession::parseSession');
        try {
            const preKeyMessageProtocol =
                await PreKeyMessageProtocol.importProto(data);
            const expectedSessionId = await CryptoUtils.singleton.keySha256(
                preKeyMessageProtocol.baseKey.key,
            );
            if (expectedSessionId !== sessionId) {
                throw new Error("Session IDs don't match.");
            }
            const cipher = await AsymmetricRatchet.create(
                identity,
                preKeyMessageProtocol,
            );
            const peerIk = await CryptoUtils.singleton.exportKey(
                preKeyMessageProtocol.identity.signingKey.key,
            );
            const session = new SignalSession(
                sessionId,
                cipher,
                peerIk,
                logger,
            );
            const decryptedMessages = await session.decryptMessages(
                preKeyMessageProtocol.signedMessage,
            );
            return [session, decryptedMessages];
        } catch (err) {
            logger.warn('Cannot parse session.');
            throw err;
        }
    }

    async encryptMessages(message: EncapsulatedIMProtoMessage[]) {
        try {
            const data = CryptoUtils.singleton.objectToBuffer(message);
            return (await this.cipher.encrypt(data)).exportProto();
        } catch (err) {
            this.logger.warn('Cannot encrypt messages.');
            throw err;
        }
    }

    async decryptData(data: ArrayBuffer) {
        try {
            return this.decryptMessages(
                await MessageSignedProtocol.importProto(data),
            );
        } catch (err) {
            this.logger.warn('Cannot decrypt data.');
            throw err;
        }
    }

    private async decryptMessages(
        message: MessageSignedProtocol,
    ): Promise<EncapsulatedIMProtoMessage[]> {
        try {
            const decryptedData = CryptoUtils.singleton.bufferToObject(
                await this.cipher.decrypt(message),
            );
            return decryptedData as EncapsulatedIMProtoMessage[];
        } catch (err) {
            this.logger.warn('Cannot decrypt messages.');
            throw err;
        }
    }
}
