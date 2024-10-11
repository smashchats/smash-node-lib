import { Identity } from '2key-ratchet';
import { SignalSession } from '@src/SignalSession.js';
import {
    EncapsulatedSmashMessage,
    SmashDID,
    SmashEndpoint,
} from '@src/types/index.js';

export class SessionManager {
    private sessions: SignalSession[] = [];
    // TODO handle dangling sessions
    private sessionsByPeer: Record<string, SignalSession> = {};
    private sessionsByID: Record<string, SignalSession> = {};

    constructor(private identity: Identity) {}

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
        );
        this.persistSession(session);
        return [session, decryptedMessages];
    }

    private persistSession(session: SignalSession) {
        this.sessions.push(session);
        this.sessionsByPeer[session.peerIk] = session;
        this.sessionsByID[session.id] = session;
    }

    async initSession(peerDid: SmashDID, endpoint: SmashEndpoint) {
        console.debug('SmashEndpoint::initSession');
        const session = await SignalSession.create(
            peerDid,
            this.identity,
            endpoint,
        );
        this.persistSession(session);
        return session;
    }
}
