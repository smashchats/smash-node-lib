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
        identity: IMPeerIdentity,
        sme: SmashEndpoint,
        logger: Logger,
    ) {
        try {
            logger.debug('SignalSession::create');
            const bundle = new PreKeyBundleProtocol();
            bundle.registrationId = 0; // warning: using fixed value, unsure about usage!

            // IK
            bundle.identity.signingKey = await ECPublicKey.create(
                await KeyUtils.importSigningPublicKey(peerDidDocument.ik),
            );
            // EK + signature
            bundle.identity.exchangeKey = await ECPublicKey.create(
                await KeyUtils.importExchangePublicKey(peerDidDocument.ek),
            );
            bundle.identity.signature = BufferUtils.stringToBuffer(
                peerDidDocument.signature,
            );
            // PreKey + signature
            bundle.preKeySigned.id = 0; // warning: using fixed value, unsure about usage!

            // TODO: more generic DID document parsing/manipulation
            // Find more DID doc serviceendpoint examples
            // Check if Bsky allow to edit DID doc with API?
            // verif key, ek, pk + endpoint
            const preKeyPublicKey = await ECPublicKey.create(
                await KeyUtils.importExchangePublicKey(sme.preKey),
            );

            bundle.preKeySigned.key = preKeyPublicKey;
            bundle.preKeySigned.signature = BufferUtils.stringToBuffer(
                sme.signature,
            );

            const protocol = await PreKeyBundleProtocol.importProto(bundle);
            const cipher = await AsymmetricRatchet.create(identity, protocol);

            const sessionId = await HashUtils.sha256FromKey(
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
            logger.warn(`Cannot create session: ${(err as Error).message}`);
            throw err;
        }
    }

    static async parseSession(
        identity: IMPeerIdentity,
        sessionId: string,
        data: ArrayBuffer,
        logger: Logger,
    ): Promise<[SignalSession, EncapsulatedIMProtoMessage[]]> {
        logger.debug('SignalSession::parseSession');
        try {
            const preKeyMessageProtocol =
                await PreKeyMessageProtocol.importProto(data);
            const expectedSessionId = await HashUtils.sha256FromKey(
                preKeyMessageProtocol.baseKey.key,
            );
            if (expectedSessionId !== sessionId) {
                throw new Error("Session IDs don't match.");
            }
            const cipher = await AsymmetricRatchet.create(
                identity,
                preKeyMessageProtocol,
            );
            const peerIk = await KeyUtils.encodeKeyAsString(
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
            const data = BufferUtils.objectToBuffer(message);
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
            const decryptedMessage = await this.cipher.decrypt(message);
            const decryptedData = BufferUtils.bufferToObject(decryptedMessage);
            return decryptedData as EncapsulatedIMProtoMessage[];
        } catch (err) {
            this.logger.warn('Cannot decrypt messages.');
            throw err;
        }
    }
}
