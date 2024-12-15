import { SignalSession } from '@src/signal/SignalSession.js';
import {
    DIDDocument,
    EncapsulatedIMProtoMessage,
    Identity,
    SmashEndpoint,
} from '@src/types/index.js';
import { Logger } from '@src/utils/index.js';
import AsyncLock from 'async-lock';

export class SessionManager {
    private sessions: SignalSession[] = [];
    // TODO handle dangling sessions
    private sessionsByPeer: Record<string, SignalSession> = {};
    private sessionsByID: Record<string, SignalSession> = {};

    constructor(
        private identity: Identity,
        private logger: Logger,
    ) {}

    getSessionByPeerIk(peerIk: string): SignalSession | undefined {
        return this.sessionsByPeer[peerIk];
    }

    getSessionById(sessionId: string): SignalSession | undefined {
        return this.sessionsByID[sessionId];
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
        this.logger.debug('persisted');
        return [session, decryptedMessages];
    }

    private persistSession(session: SignalSession) {
        this.sessions.push(session);
        this.sessionsByPeer[session.peerIk] = session;
        this.sessionsByID[session.id] = session;
    }

    async initSession(peerDidDocument: DIDDocument, endpoint: SmashEndpoint) {
        this.logger.debug('SmashEndpoint::initSession');
        const session = await SignalSession.create(
            peerDidDocument,
            this.identity,
            endpoint,
            this.logger,
        );
        this.persistSession(session);
        return session;
    }

    async getOrCreateSessionForPeer(
        peerDidDocument: DIDDocument,
        endpoint: SmashEndpoint,
    ): Promise<SignalSession> {
        const existingSession = this.getSessionByPeerIk(peerDidDocument.ik);

        if (existingSession && !existingSession.isExpired()) {
            return existingSession;
        }

        // Create new session
        const session = await SignalSession.create(
            peerDidDocument,
            this.identity,
            endpoint,
            this.logger,
        );

        this.persistSession(session);
        return session;
    }

    private removeAllPeerSessions(
        peerIK: string,
        deleteActiveSession: boolean,
    ) {
        if (deleteActiveSession) {
            delete this.sessionsByPeer[peerIK];
        }
        const sessionToKeep: SignalSession | undefined =
            this.sessionsByPeer[peerIK];
        let removed = 0;
        this.sessions = this.sessions.filter((s) => {
            if (
                s.peerIk === peerIK &&
                (deleteActiveSession || s.id !== sessionToKeep.id)
            ) {
                delete this.sessionsByID[s.id];
                removed++;
                return false;
            }
            return true;
        });
        if (globalThis.gc) globalThis.gc();
        this.logger.debug(`Removed ${removed} sessions for peer ${peerIK}`);
    }

    private handleSessionResetMutex = new AsyncLock();
    async handleSessionReset(
        peerIK: string,
        keepActive: boolean = false,
    ): Promise<void> {
        await this.handleSessionResetMutex.acquire(
            'handleSessionReset',
            async () => {
                this.logger.debug(`handleSessionReset for peer ${peerIK}`);
                this.removeAllPeerSessions(peerIK, !keepActive);
            },
        );
    }
}
