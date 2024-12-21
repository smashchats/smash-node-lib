import { SignalSession } from '@src/signal/SignalSession.js';
import {
    DIDDocument,
    EncapsulatedIMProtoMessage,
    Identity,
    SmashEndpoint,
} from '@src/types/index.js';
import { Logger } from '@src/utils/index.js';

export class SessionManager {
    private sessions: SignalSession[] = [];
    // TODO handle dangling sessions
    private readonly sessionsByPeer: Record<string, SignalSession> = {};
    private readonly sessionsByID: Record<string, SignalSession> = {};

    constructor(
        private readonly identity: Identity,
        private readonly logger: Logger,
    ) {}

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

    async parseSession(
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
