import { Identity } from '2key-ratchet';
import { Logger } from '@src/Logger.js';
import { SignalSession } from '@src/SignalSession.js';
import {
    EncapsulatedSmashMessage,
    SmashDID,
    SmashEndpoint,
} from '@src/types/index.js';
import AsyncLock from 'async-lock';

import { SmashPeer } from './SmashPeer.js';

export class SessionManager {
    private sessions: SignalSession[] = [];
    // TODO handle dangling sessions
    private sessionsByPeer: Record<string, SignalSession> = {};
    private sessionsByID: Record<string, SignalSession> = {};

    constructor(
        private identity: Identity,
        private logger: Logger,
    ) {}

    getSessionByPeer(peer: SmashDID): SignalSession | undefined {
        return this.sessionsByPeer[peer.ik];
    }

    getSessionById(sessionId: string): SignalSession | undefined {
        return this.sessionsByID[sessionId];
    }

    async parseSession(
        sessionId: string,
        data: ArrayBuffer,
    ): Promise<[SignalSession, EncapsulatedSmashMessage[]]> {
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

    async initSession(peerDid: SmashDID, endpoint: SmashEndpoint) {
        this.logger.debug('SmashEndpoint::initSession');
        const session = await SignalSession.create(
            peerDid,
            this.identity,
            endpoint,
            this.logger,
        );
        this.persistSession(session);
        return session;
    }

    async getOrCreateSessionForPeer(
        peer: SmashDID,
        endpoint: SmashEndpoint,
    ): Promise<SignalSession> {
        const existingSession = this.getSessionByPeer(peer);

        if (existingSession && !existingSession.isExpired()) {
            return existingSession;
        }

        // Create new session
        const session = await SignalSession.create(
            peer,
            this.identity,
            endpoint,
            this.logger,
        );

        this.persistSession(session);
        return session;
    }

    private removeAllPeerSessions(
        peer: SmashDID,
        deleteActiveSession: boolean,
    ) {
        if (deleteActiveSession) {
            delete this.sessionsByPeer[peer.ik];
        }
        const sessionToKeep: SignalSession | undefined =
            this.sessionsByPeer[peer.ik];
        let removed = 0;
        this.sessions = this.sessions.filter((s) => {
            if (
                s.peerIk === peer.ik &&
                (deleteActiveSession || s.id !== sessionToKeep.id)
            ) {
                delete this.sessionsByID[s.id];
                removed++;
                return false;
            }
            return true;
        });
        if (globalThis.gc) globalThis.gc();
        this.logger.debug(`Removed ${removed} sessions for peer ${peer.ik}`);
    }

    private handleSessionResetMutex = new AsyncLock();
    async handleSessionReset(
        peer: SmashPeer,
        keepActive: boolean = false,
    ): Promise<void> {
        await this.handleSessionResetMutex.acquire(
            'handleSessionReset',
            async () => {
                const peerDID = peer.getDID();
                this.logger.debug(`handleSessionReset for peer ${peerDID.id}`);
                this.removeAllPeerSessions(peerDID, !keepActive);
            },
        );
    }
}
