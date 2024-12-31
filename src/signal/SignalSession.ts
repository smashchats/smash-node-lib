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
    // TODO cleanup outdated sessions after a grace period
    // TODO think about coordinated TTL constants
    public static readonly SESSION_TTL_MS = EXPIRATION_TIME_MS;

    public firstUse: boolean = true;

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
            logger.debug('SignalSession::create');
            const bundle = new PreKeyBundleProtocol();
            bundle.registrationId = 0; // warning: using fixed value, unsure about usage!

            const c = CryptoUtils.singleton;

            // IK
            bundle.identity.signingKey = await ECPublicKey.create(
                await c.importSigningPublicKey(peerDidDocument.ik),
            );
            // EK + signature
            bundle.identity.exchangeKey = await ECPublicKey.create(
                await c.importExchangePublicKey(peerDidDocument.ek),
            );
            bundle.identity.signature = c.stringToBuffer(
                peerDidDocument.signature,
            );
            // PreKey + signature
            bundle.preKeySigned.id = 0; // warning: using fixed value, unsure about usage!

            // TODO: more generic DID document parsing/manipulation
            // Find more DID doc serviceendpoint examples
            // Check if Bsky allow to edit DID doc with API?
            // verif key, ek, pk + endpoint
            const preKeyPublicKey = await ECPublicKey.create(
                await c.importExchangePublicKey(sme.preKey),
            );

            bundle.preKeySigned.key = preKeyPublicKey;
            bundle.preKeySigned.signature = c.stringToBuffer(sme.signature);

            const protocol = await PreKeyBundleProtocol.importProto(bundle);
            const cipher = await AsymmetricRatchet.create(identity, protocol);

            const sessionId = await c.keySha256(
                cipher.currentRatchetKey.publicKey.key,
            );
            const session = new SignalSession(
                sessionId,
                cipher,
                peerDidDocument.ik,
                logger,
            );
            logger.debug(`>> session created with id ${sessionId}`);
            return session;
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
