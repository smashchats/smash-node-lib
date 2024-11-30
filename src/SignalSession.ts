import {
    AsymmetricRatchet,
    ECPublicKey,
    Identity,
    MessageSignedProtocol,
    PreKeyBundleProtocol,
    PreKeyMessageProtocol,
} from '2key-ratchet';
import CryptoUtils from '@src/CryptoUtils.js';
import { Logger } from '@src/Logger.js';
import {
    ENCODING,
    EncapsulatedSmashMessage,
    SmashDID,
    SmashEndpoint,
} from '@src/types/index.js';
import { Buffer } from 'buffer';

export class SignalSession {
    constructor(
        public readonly id: string,
        private cipher: AsymmetricRatchet,
        public readonly peerIk: string,
        private logger: Logger,
    ) {}

    static async create(
        peer: SmashDID,
        identity: Identity,
        sme: SmashEndpoint,
        logger: Logger,
    ) {
        try {
            const bundle = new PreKeyBundleProtocol();
            bundle.registrationId = 0; // warning: using fixed value, unsure about usage!
            bundle.identity.signingKey = await ECPublicKey.create(
                await CryptoUtils.singleton.importKey(peer.ik),
            );
            bundle.identity.exchangeKey = await ECPublicKey.create(
                await CryptoUtils.singleton.importKey(peer.ek),
            );
            bundle.identity.signature = Buffer.from(peer.signature, ENCODING);

            bundle.preKeySigned.id = 0; // warning: using fixed value, unsure about usage!
            bundle.preKeySigned.key = await ECPublicKey.create(
                await CryptoUtils.singleton.importKey(sme.preKey),
            );
            bundle.preKeySigned.signature = Buffer.from(
                sme.signature,
                ENCODING,
            );

            const protocol = await PreKeyBundleProtocol.importProto(bundle);
            const cipher = await AsymmetricRatchet.create(identity, protocol);

            const sessionId = await CryptoUtils.singleton.keySha256(
                cipher.currentRatchetKey.publicKey.key,
            );
            return new SignalSession(sessionId, cipher, peer.ik, logger);
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
    ): Promise<[SignalSession, EncapsulatedSmashMessage[]]> {
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

    async encryptMessages(message: EncapsulatedSmashMessage[]) {
        try {
            const data = Buffer.from(JSON.stringify(message));
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
    ): Promise<EncapsulatedSmashMessage[]> {
        try {
            const decryptedData = Buffer.from(
                await this.cipher.decrypt(message),
            );
            return JSON.parse(
                decryptedData.toString(),
            ) as EncapsulatedSmashMessage[];
        } catch (err) {
            this.logger.warn('Cannot decrypt messages.');
            throw err;
        }
    }
}
