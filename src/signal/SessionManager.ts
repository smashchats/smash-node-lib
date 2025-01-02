import { IMPeerIdentity } from '@src/IMPeerIdentity.js';
import { MessageMiddleware } from '@src/MessageMiddleware.js';
import { DLQ } from '@src/signal/DLQ.js';
import { SignalSession } from '@src/signal/SignalSession.js';
import {
    DIDDocument,
    EncapsulatedIMProtoMessage,
    IM_DID_DOCUMENT,
    SmashEndpoint,
} from '@src/types/index.js';
import { CryptoUtils, Logger } from '@src/utils/index.js';

export class SessionManager {
    // TODO handle dangling sessions
    private sessions: SignalSession[] = [];
    private readonly sessionsByPeer: Record<string, SignalSession> = {};
    private readonly sessionsByID: Record<string, SignalSession> = {};
    private readonly dlq: DLQ<string, ArrayBuffer> = new DLQ();

    private cachedDIDMessage: EncapsulatedIMProtoMessage | undefined;
    public async getDIDMessage(): Promise<EncapsulatedIMProtoMessage> {
        if (!this.cachedDIDMessage) {
            const didDocument = await this.identity.getDIDDocument();
            this.cachedDIDMessage =
                await CryptoUtils.singleton.encapsulateMessage({
                    type: IM_DID_DOCUMENT,
                    data: didDocument,
                    after: '',
                });
        }
        return this.cachedDIDMessage;
    }

    constructor(
        private readonly identity: IMPeerIdentity,
        private readonly logger: Logger,
        private readonly messageMiddleware: MessageMiddleware,
    ) {}

    async incomingData(sessionId: string, data: ArrayBuffer) {
        const session = this.getById(sessionId);
        if (session) {
            this.logger.info(`Incoming data for session ${sessionId}`);
            const decryptedMessages = await session.decryptData(data);
            this.setPreferred(session);
            this.messageMiddleware.handle(session.peerIk, decryptedMessages);
            this.logger.info(`Incoming data for session ${sessionId}`);
        } else {
            await this.attemptNewSession(sessionId, data);
        }
    }

    private async attemptNewSession(sessionId: string, data: ArrayBuffer) {
        try {
            const [parsedSession, firstMessages] = await this.parseSession(
                sessionId,
                data,
            );
            this.logger.info(`New session ${sessionId}`);
            this.setPreferred(parsedSession);
            const dlqMessages = await this.processQueuedMessages(parsedSession);
            const messages = [...firstMessages, ...dlqMessages];
            const peerIk = parsedSession.peerIk;
            this.messageMiddleware.handle(peerIk, messages);
        } catch (err) {
            if (
                err instanceof Error &&
                err.message.startsWith(
                    'Cannot decode message for PreKeyMessage.',
                )
            ) {
                this.logger.info(
                    `Queuing data for session ${sessionId} (${err.message})`,
                );
                this.dlq.push(sessionId, data);
            } else {
                this.logger.warn(`Unprocessable data for session ${sessionId}`);
                throw err;
            }
        }
    }

    private async processQueuedMessages(session: SignalSession) {
        const dlqMessages = this.dlq.get(session.id);
        this.logger.debug(
            `processQueuedMessages for ${session.id} (${dlqMessages?.length})`,
        );
        if (!dlqMessages || !dlqMessages?.length) return [];
        const decryptedMessages = (
            await Promise.all(
                dlqMessages.map((message) => session.decryptData(message)),
            )
        ).flat();
        this.dlq.delete(session.id);
        this.logger.debug(
            `> Cleared DLQ (${decryptedMessages.length}/${dlqMessages.length})`,
        );
        return decryptedMessages;
    }

    private getSessionAndClearIfExpired(
        session: SignalSession | undefined,
        sessionKey: string,
        sessionStore: Record<string, SignalSession>,
    ): SignalSession | undefined {
        if (session?.isExpired()) {
            this.logger.debug(
                `Clearing expired session ${session.id} for peer ${session.peerIk}`,
            );
            delete sessionStore[sessionKey];
            return undefined;
        }
        return session;
    }

    getById(sessionId: string): SignalSession | undefined {
        return this.getSessionAndClearIfExpired(
            this.sessionsByID[sessionId],
            sessionId,
            this.sessionsByID,
        );
    }

    getPreferredForPeerIk(peerIk: string): SignalSession | undefined {
        return this.getSessionAndClearIfExpired(
            this.sessionsByPeer[peerIk],
            peerIk,
            this.sessionsByPeer,
        );
    }

    setPreferred(session: SignalSession) {
        if (this.sessionsByPeer[session.peerIk]?.id === session.id) return;
        this.logger.debug(
            `Set preferred session for ${session.peerIk}: ${session.id}`,
        );
        this.sessionsByPeer[session.peerIk] = session;
    }

    resetPreferredSession(peerIk: string) {
        delete this.sessionsByPeer[peerIk];
        this.logger.debug(`Reset preferred session for ${peerIk}`);
    }

    private async parseSession(
        sessionId: string,
        data: ArrayBuffer,
    ): Promise<[SignalSession, EncapsulatedIMProtoMessage[]]> {
        const [session, decryptedMessages] = await SignalSession.parseSession(
            this.identity,
            sessionId,
            data,
            this.logger,
        );
        this.persistSession(session);
        return [session, decryptedMessages];
    }

    private persistSession(session: SignalSession) {
        this.sessions.push(session);
        this.sessionsByID[session.id] = session;
        this.logger.debug(`persisted session ${session.id}`);
    }

    async initSession(peerDidDocument: DIDDocument, endpoint: SmashEndpoint) {
        this.logger.debug('SessionManager::initSession');
        const session = await SignalSession.create(
            peerDidDocument,
            this.identity,
            endpoint,
            this.logger,
        );
        this.logger.debug(
            `created session ${session.id} with peer IK ${peerDidDocument.ik} (${peerDidDocument.id})`,
        );
        this.persistSession(session);
        return session;
    }

    removeAllSessionsForPeerIK(
        peerIK: string,
        deleteActiveSession: boolean = false,
    ) {
        this.logger.debug(
            `SessionManager::removeAllSessionsForPeerIK: for ${peerIK} (deleteActiveSession: ${deleteActiveSession})`,
        );
        this.logger.debug(
            `> initial sessions: ${this.sessions.map((s) => s.id).join(', ')}`,
        );
        let sessionToKeep: SignalSession | undefined;
        if (!deleteActiveSession) {
            sessionToKeep = this.sessionsByPeer[peerIK];
        }
        this.resetPreferredSession(peerIK);
        let removed = 0;
        this.sessions = this.sessions.filter((s) => {
            if (
                s.peerIk === peerIK &&
                (deleteActiveSession || s.id !== sessionToKeep?.id)
            ) {
                delete this.sessionsByID[s.id];
                removed++;
                return false;
            }
            return true;
        });
        if (globalThis.gc) globalThis.gc();
        this.logger.debug(`> removed ${removed} sessions for peer ${peerIK}`);
        this.logger.debug(
            `> sessions after removal: ${this.sessions.map((s) => s.id).join(', ')}`,
        );
    }
}
