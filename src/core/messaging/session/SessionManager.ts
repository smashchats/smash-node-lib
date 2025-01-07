import { encapsulateMessage } from '@src/api/tools/encapsulateMessage.js';
import { IMPeerIdentity } from '@src/core/identity/IMPeerIdentity.js';
import { MessageMiddleware } from '@src/core/messaging/protocol/MessageMiddleware.js';
import { SignalSession } from '@src/core/messaging/session/SignalSession.js';
import { IM_DID_DOCUMENT } from '@src/shared/lexicon/improto.lexicon.js';
import { DIDDocument } from '@src/shared/types/did.types.js';
import type { EncapsulatedIMProtoMessage } from '@src/shared/types/message.types.js';
import { SmashEndpoint } from '@src/shared/types/sme.types.js';
import { DLQ } from '@src/shared/utils/DLQ.js';
import { Logger } from '@src/shared/utils/Logger.js';

export class SessionManager {
    private sessions: SignalSession[] = [];
    private readonly sessionsByPeer: Record<string, SignalSession> = {};
    private readonly sessionsByID: Record<string, SignalSession> = {};
    private readonly dlq: DLQ<string, ArrayBuffer> = new DLQ();
    private cachedDIDMessage: EncapsulatedIMProtoMessage | undefined;

    constructor(
        private readonly identity: IMPeerIdentity,
        private readonly logger: Logger,
        private readonly messageMiddleware: MessageMiddleware,
    ) {}

    public async getDIDMessage(): Promise<EncapsulatedIMProtoMessage> {
        if (!this.cachedDIDMessage) {
            const didDocument = await this.identity.getDIDDocument();
            this.cachedDIDMessage = await encapsulateMessage({
                type: IM_DID_DOCUMENT,
                data: didDocument,
                after: '',
            });
        }
        return this.cachedDIDMessage;
    }

    public async incomingData(
        sessionId: string,
        data: ArrayBuffer,
    ): Promise<void> {
        const session = this.getById(sessionId);

        if (session) {
            await this.handleExistingSession(session, data);
        } else {
            await this.attemptNewSession(sessionId, data);
        }
    }

    public getById(sessionId: string): SignalSession | undefined {
        return this.getSessionAndClearIfExpired(
            this.sessionsByID[sessionId],
            sessionId,
            this.sessionsByID,
        );
    }

    public getPreferredForPeerIk(peerIk: string): SignalSession | undefined {
        return this.getSessionAndClearIfExpired(
            this.sessionsByPeer[peerIk],
            peerIk,
            this.sessionsByPeer,
        );
    }

    public setPreferred(session: SignalSession): void {
        if (this.sessionsByPeer[session.peerIk]?.id === session.id) return;

        this.logger.debug(
            `Set preferred session for ${session.peerIk}: ${session.id}`,
        );
        this.sessionsByPeer[session.peerIk] = session;
    }

    public resetPreferredSession(peerIk: string): void {
        delete this.sessionsByPeer[peerIk];
        this.logger.debug(`Reset preferred session for ${peerIk}`);
    }

    public async initSession(
        peerDidDocument: DIDDocument,
        endpoint: SmashEndpoint,
    ): Promise<SignalSession> {
        this.logger.debug('SessionManager::initSession');

        const session = await SignalSession.create(
            peerDidDocument,
            this.identity,
            endpoint,
            this.logger,
        );

        this.logger.debug(
            `Created session ${session.id} with peer IK ${peerDidDocument.ik} (${peerDidDocument.id})`,
        );

        this.persistSession(session);
        return session;
    }

    public removeAllSessionsForPeerIK(
        peerIK: string,
        deleteActiveSession: boolean = false,
    ): void {
        this.logger.debug(
            `Removing sessions for ${peerIK} (deleteActiveSession: ${deleteActiveSession})`,
        );

        const sessionToKeep = !deleteActiveSession
            ? this.sessionsByPeer[peerIK]
            : undefined;
        this.resetPreferredSession(peerIK);

        let removed = 0;
        this.sessions = this.sessions.filter((session) => {
            if (
                session.peerIk === peerIK &&
                (deleteActiveSession || session.id !== sessionToKeep?.id)
            ) {
                delete this.sessionsByID[session.id];
                removed++;
                return false;
            }
            return true;
        });

        if (globalThis.gc) globalThis.gc();

        this.logger.debug(`Removed ${removed} sessions for peer ${peerIK}`);
        this.logger.debug(
            `Remaining sessions: ${this.sessions.map((s) => s.id).join(', ')}`,
        );
    }

    private async handleExistingSession(
        session: SignalSession,
        data: ArrayBuffer,
    ): Promise<void> {
        this.logger.info(`Incoming data for session ${session.id}`);
        const decryptedMessages = await session.decryptData(data);
        this.setPreferred(session);
        await this.messageMiddleware.handle(session.peerIk, decryptedMessages);
    }

    private async attemptNewSession(
        sessionId: string,
        data: ArrayBuffer,
    ): Promise<void> {
        try {
            const [parsedSession, firstMessages] = await this.parseSession(
                sessionId,
                data,
            );
            this.logger.info(`New session ${sessionId}`);

            this.setPreferred(parsedSession);
            const dlqMessages = await this.processQueuedMessages(parsedSession);
            const messages = [...firstMessages, ...dlqMessages];

            await this.messageMiddleware.handle(parsedSession.peerIk, messages);
        } catch (err) {
            this.handleSessionError(err, sessionId, data);
        }
    }

    private handleSessionError(
        err: unknown,
        sessionId: string,
        data: ArrayBuffer,
    ): void {
        if (
            err instanceof Error &&
            err.message.startsWith('Cannot decode message for PreKeyMessage.')
        ) {
            this.logger.info(
                `Queuing data for session ${sessionId} (${err.message})`,
            );
            this.dlq.push(sessionId, data);
            return;
        }

        this.logger.warn(`Unprocessable data for session ${sessionId}`);
        throw err;
    }

    private async processQueuedMessages(
        session: SignalSession,
    ): Promise<EncapsulatedIMProtoMessage[]> {
        const dlqMessages = this.dlq.get(session.id);
        this.logger.debug(
            `Processing queued messages for ${session.id} (${dlqMessages?.length ?? 0})`,
        );

        if (!dlqMessages?.length) return [];

        const decryptedMessages = (
            await Promise.all(
                dlqMessages.map((message) => session.decryptData(message)),
            )
        ).flat();

        this.dlq.delete(session.id);
        this.logger.debug(
            `Cleared DLQ (${decryptedMessages.length}/${dlqMessages.length})`,
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

    private persistSession(session: SignalSession): void {
        this.sessions.push(session);
        this.sessionsByID[session.id] = session;
        this.logger.debug(`Persisted session ${session.id}`);
    }
}
