import {
    AsymmetricRatchet,
    ECPublicKey,
    MessageSignedProtocol,
    PreKeyBundleProtocol,
    PreKeyMessageProtocol,
} from '2key-ratchet';
import { BufferUtils } from '@src/core/crypto/utils/BufferUtils.js';
import { HashUtils } from '@src/core/crypto/utils/HashUtils.js';
import { KeyUtils } from '@src/core/crypto/utils/KeyUtils.js';
import type { IMPeerIdentity } from '@src/core/identity/IMPeerIdentity.js';
import { EXPIRATION_TIME_MS } from '@src/shared/constants/protocol.js';
import type { DIDDocument } from '@src/shared/types/did.types.js';
import type { EncapsulatedIMProtoMessage } from '@src/shared/types/message.types.js';
import type { SmashEndpoint } from '@src/shared/types/sme.types.js';
import type { Logger } from '@src/shared/utils/Logger.js';

export class SignalSession {
    // TODO cleanup outdated sessions after a grace period
    // TODO think about coordinated TTL constants
    public static readonly SESSION_TTL_MS = EXPIRATION_TIME_MS;
    public readonly createdAtTime: number = Date.now();
    public firstUse: boolean = true;

    private constructor(
        public readonly id: string,
        private readonly cipher: AsymmetricRatchet,
        public readonly peerIk: string,
        private readonly logger: Logger,
    ) {}

    public isExpired(): boolean {
        return Date.now() - this.createdAtTime > SignalSession.SESSION_TTL_MS;
    }

    public static async create(
        peerDidDocument: DIDDocument,
        identity: IMPeerIdentity,
        sme: SmashEndpoint,
        logger: Logger,
    ): Promise<SignalSession> {
        logger.debug('SignalSession::create');

        try {
            const bundle = await this.createPreKeyBundle(peerDidDocument, sme);
            const protocol = await PreKeyBundleProtocol.importProto(bundle);
            const cipher = await AsymmetricRatchet.create(identity, protocol);
            const sessionId = await this.generateSessionId(cipher);

            const session = new SignalSession(
                sessionId,
                cipher,
                peerDidDocument.ik,
                logger,
            );

            logger.debug(`>> session created with id ${sessionId}`);
            return session;
        } catch (err) {
            logger.warn(`Cannot create session: ${(err as Error).message}`);
            throw err;
        }
    }

    private static async createPreKeyBundle(
        peerDidDocument: DIDDocument,
        sme: SmashEndpoint,
    ): Promise<PreKeyBundleProtocol> {
        const bundle = new PreKeyBundleProtocol();
        bundle.registrationId = 0; // Fixed value, pending review

        // Set identity keys
        bundle.identity.signingKey = await ECPublicKey.create(
            await KeyUtils.importSigningPublicKey(peerDidDocument.ik),
        );
        bundle.identity.exchangeKey = await ECPublicKey.create(
            await KeyUtils.importExchangePublicKey(peerDidDocument.ek),
        );
        bundle.identity.signature = BufferUtils.stringToBuffer(
            peerDidDocument.signature,
        );

        // Set pre-key data
        bundle.preKeySigned.id = 0; // Fixed value, pending review
        bundle.preKeySigned.key = await ECPublicKey.create(
            await KeyUtils.importExchangePublicKey(sme.preKey),
        );
        bundle.preKeySigned.signature = BufferUtils.stringToBuffer(
            sme.signature,
        );

        return bundle;
    }

    private static async generateSessionId(
        cipher: AsymmetricRatchet,
    ): Promise<string> {
        return HashUtils.sha256FromKey(cipher.currentRatchetKey.publicKey.key);
    }

    public static async parseSession(
        identity: IMPeerIdentity,
        sessionId: string,
        data: ArrayBuffer,
        logger: Logger,
    ): Promise<[SignalSession, EncapsulatedIMProtoMessage[]]> {
        logger.debug('SignalSession::parseSession');

        try {
            const preKeyMessage = await PreKeyMessageProtocol.importProto(data);
            await this.validateSessionId(sessionId, preKeyMessage);

            const cipher = await AsymmetricRatchet.create(
                identity,
                preKeyMessage,
            );
            const peerIk = await KeyUtils.encodeKeyAsString(
                preKeyMessage.identity.signingKey.key,
            );

            const session = new SignalSession(
                sessionId,
                cipher,
                peerIk,
                logger,
            );
            const messages = await session.decryptMessages(
                preKeyMessage.signedMessage,
            );

            return [session, messages];
        } catch (err) {
            logger.warn('Cannot parse session.');
            throw err;
        }
    }

    private static async validateSessionId(
        sessionId: string,
        preKeyMessage: PreKeyMessageProtocol,
    ): Promise<void> {
        const expectedId = await HashUtils.sha256FromKey(
            preKeyMessage.baseKey.key,
        );
        if (expectedId !== sessionId) {
            throw new Error("Session IDs don't match.");
        }
    }

    public async encryptMessages(
        messages: EncapsulatedIMProtoMessage[],
    ): Promise<ArrayBuffer> {
        try {
            const data = BufferUtils.objectToBuffer(messages);
            return (await this.cipher.encrypt(data)).exportProto();
        } catch (err) {
            this.logger.warn('Cannot encrypt messages.');
            throw err;
        }
    }

    public async decryptData(
        data: ArrayBuffer,
    ): Promise<EncapsulatedIMProtoMessage[]> {
        try {
            const message = await MessageSignedProtocol.importProto(data);
            return this.decryptMessages(message);
        } catch (err) {
            // TODO: Consider emitting a dedicated 'error:decryption' event so users can react, e.g. retire sessions or request rekey.
            this.logger.warn('Cannot decrypt data.');
            throw err;
        }
    }

    private async decryptMessages(
        message: MessageSignedProtocol,
    ): Promise<EncapsulatedIMProtoMessage[]> {
        try {
            const decrypted = await this.cipher.decrypt(message);
            return BufferUtils.bufferToObject(decrypted);
        } catch (err) {
            // TODO: Consider emitting a dedicated 'error:decryption' event so users can react, e.g. retire sessions or request rekey.
            this.logger.warn('Cannot decrypt messages.');
            throw err;
        }
    }
}
