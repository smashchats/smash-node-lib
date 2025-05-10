import { createServer } from 'node:http';
import { URL as NodeURL } from 'node:url';
import { Server, Socket } from 'socket.io';

const HOSTNAME = 'localhost';
const PORT = 12345;

const API_PATH = 'api';
const WEBSOCKET_PATH = 'socket.io';
const VALID_PATH = 'valid';
const SECONDARY_PATH = 'secondary';
const EMPTY_PATH = 'empty';
const QUIET_PATH = 'quiet';

export const apiServerUrl = `http://${HOSTNAME}:${PORT}/${API_PATH}`;
export const socketServerUrl = `http://${HOSTNAME}:${PORT}/${VALID_PATH}`;
export const emptySocketServerUrl = `http://${HOSTNAME}:${PORT}/${EMPTY_PATH}`;
export const quietSocketServerUrl = `http://${HOSTNAME}:${PORT}/${QUIET_PATH}`;
export const secondarySocketServerUrl = `http://${HOSTNAME}:${PORT}/${SECONDARY_PATH}`;

const subtle = globalThis.crypto.subtle;

const ENCODING = 'base64' as const;
const EXPORTABLE = 'spki' as const;

export const SME_PUBLIC_KEY =
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEg6rwXUOg3N18rZlQRS8sCmKGuB4opGtTXvYi7DkXltVzK0rEVd91HgM7L9YEyTsM9ntJ8Ye+rHey0LiUZwFwAw==';
const SME_PRIVATE_KEY =
    'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgeDOtDxdjN36dlxG7Z2Rh3E41crFpQEse0xaxBlaVRRWhRANCAASDqvBdQ6Dc3XytmVBFLywKYoa4Hiika1Ne9iLsOReW1XMrSsRV33UeAzsv1gTJOwz2e0nxh76sd7LQuJRnAXAD';
const KEY_ALGORITHM = {
    name: 'ECDH',
    namedCurve: 'P-256',
} as const;
export const SME_CONFIG = {
    keyAlgorithm: KEY_ALGORITHM,
    encryptionAlgorithm: { name: 'AES-GCM', length: 256 },
    challengeEncoding: ENCODING,
};
const KEY_USAGES = ['deriveBits', 'deriveKey'] as never;

const exportKey = async (key: CryptoKey, encoding = ENCODING) => {
    return Buffer.from(await subtle.exportKey(EXPORTABLE, key)).toString(
        encoding,
    );
};

const importKey = async (
    keyEncoded: string,
    keyAlgorithm: KeyAlgorithm,
    exportable = true,
    usages: KeyUsage[] = [],
    encoding: BufferEncoding = ENCODING,
    format: Exclude<KeyFormat, 'jwk'> = EXPORTABLE,
) => {
    return await subtle.importKey(
        format,
        Buffer.from(keyEncoded, encoding),
        keyAlgorithm,
        exportable,
        usages,
    );
};

const importClientPublicKey = async (socket: Socket) => {
    return await importKey(
        socket.handshake.auth.key,
        socket.handshake.auth.keyAlgorithm,
    );
};

const getPeerIdFromUrl = (reqUrl: string) => {
    const url = new NodeURL(reqUrl, 'http://localhost');
    return url.searchParams.get('peerId');
};

let httpServer: ReturnType<typeof createServer>;
let socketServer: Server;
const activeSockets: Record<string, Socket> = {};
const messagesToDelay: Record<string, number> = {};
const dataEvents: {
    peerId: string;
    sessionId: string;
    data: unknown;
    endpoint: string;
}[] = [];
const serverInstanceId = Math.random().toString(36).substring(7);

const initChallengeEndpoint = async (
    clientPublicKey: CryptoKey,
    socketClient: Socket,
) => {
    try {
        const symKey = await subtle.deriveKey(
            {
                ...socketClient.handshake.auth.keyAlgorithm,
                public: clientPublicKey,
            },
            await importKey(
                SME_PRIVATE_KEY,
                KEY_ALGORITHM,
                true,
                KEY_USAGES,
                'base64',
                'pkcs8',
            ),
            SME_CONFIG.encryptionAlgorithm,
            false,
            ['encrypt', 'decrypt'],
        );
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const challenge = crypto.getRandomValues(new Uint8Array(12));
        const ivBuf = Buffer.from(iv);
        const challengeBuf = Buffer.from(challenge);
        const encryptedChallenge = await subtle.encrypt(
            {
                ...SME_CONFIG.encryptionAlgorithm,
                iv: iv,
            },
            symKey,
            challengeBuf,
        );
        const encryptedChallengeBuf = Buffer.from(encryptedChallenge);
        socketClient.on(
            'register',
            async (_: unknown, ack: () => void | undefined) => {
                if (ack) ack();
            },
        );
        socketClient.emit('challenge', {
            iv: ivBuf.toString(SME_CONFIG.challengeEncoding),
            challenge: encryptedChallengeBuf.toString(
                SME_CONFIG.challengeEncoding,
            ),
        });
    } catch (error) {
        console.error(
            `Error in initChallengeEndpoint for socket ID ${socketClient.id}:`,
            error,
        );
    }
};

const initDataEndpoint = async (
    endpoint: string,
    clientPublicKey: CryptoKey | undefined,
    client: Socket,
    shouldAck = true,
) => {
    const clientKeyId = clientPublicKey
        ? await exportKey(clientPublicKey)
        : 'ANONYMOUS';
    if (clientPublicKey) {
        activeSockets[clientKeyId] = client;
        client.on('disconnect', async () => {
            delete activeSockets[clientKeyId];
        });
    }
    client.on(
        'data',
        async (
            peerId: string,
            sessionId: string,
            data: unknown,
            acknowledge: () => void,
        ) => {
            if (!activeSockets[peerId]) {
                return;
            }
            let delayMs = 0;
            if (messagesToDelay[peerId]) {
                delayMs = messagesToDelay[peerId] * 250;
                messagesToDelay[peerId] = messagesToDelay[peerId] - 1;
            }
            dataEvents.push({
                peerId,
                sessionId,
                data,
                endpoint,
            });
            setTimeout(() => {
                if (!activeSockets[peerId]) {
                    return;
                }
                activeSockets[peerId].emit('data', sessionId, data);
            }, delayMs);
            if (shouldAck) {
                acknowledge();
            }
        },
    );
};

export function startMockSmeServer() {
    if (httpServer)
        return {
            server: httpServer,
            io: socketServer,
            instanceId: serverInstanceId,
        };
    httpServer = createServer((req, res) => {
        console.log('[SME Server] HTTP request', {
            method: req.method,
            url: req.url,
        });
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        // /api/server-info
        if (req.method === 'GET' && req.url === `/${API_PATH}/server-info`) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    instanceId: serverInstanceId,
                    dataEventsCount: dataEvents.length,
                    activeSocketsCount: Object.keys(activeSockets).length,
                }),
            );
            return;
        }
        // /api/delay-next-messages
        if (
            req.method === 'GET' &&
            req.url?.startsWith(`/${API_PATH}/delay-next-messages`)
        ) {
            const peerId = getPeerIdFromUrl(req.url);
            if (!peerId) {
                res.writeHead(400);
                res.end('Missing peerId parameter');
                return;
            }
            messagesToDelay[peerId] = 10;
            res.writeHead(200);
            res.end();
            return;
        }
        // /api/data-events
        if (
            req.method === 'GET' &&
            req.url?.startsWith(`/${API_PATH}/data-events`)
        ) {
            const peerId = getPeerIdFromUrl(req.url);
            let filteredEvents = peerId
                ? dataEvents.filter((event) => event.peerId === peerId)
                : dataEvents;
            if (!Array.isArray(filteredEvents)) filteredEvents = [];
            console.log('[SME Server] /api/data-events', {
                peerId,
                filteredEvents,
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(filteredEvents));
            return;
        }
        if (
            req.method === 'DELETE' &&
            req.url?.startsWith(`/${API_PATH}/data-events`)
        ) {
            const peerId = getPeerIdFromUrl(req.url);
            if (peerId) {
                let index = dataEvents.length;
                while (index--) {
                    if (dataEvents[index].peerId === peerId) {
                        dataEvents.splice(index, 1);
                    }
                }
            } else {
                dataEvents.length = 0;
            }
            res.writeHead(200);
            res.end(JSON.stringify(dataEvents));
            return;
        }
        res.writeHead(404);
        res.end('Not found');
    });
    socketServer = new Server(httpServer, {
        path: `/${WEBSOCKET_PATH}`,
        cors: {
            origin: '*',
            methods: ['GET', 'POST', 'DELETE'],
        },
    });
    // Namespace setup
    const mainNamespace = socketServer.of('/' + VALID_PATH);
    const secondaryNamespace = socketServer.of('/' + SECONDARY_PATH);
    const emptyNamespace = socketServer.of('/' + EMPTY_PATH);
    const quietNamespace = socketServer.of('/' + QUIET_PATH);
    quietNamespace.on('connection', async (client) => {
        const auth = !!client.handshake.auth.key;
        const clientPublicKey = auth
            ? await importClientPublicKey(client)
            : undefined;
        await initDataEndpoint(
            quietSocketServerUrl,
            clientPublicKey,
            client,
            false,
        );
        if (clientPublicKey) {
            await initChallengeEndpoint(clientPublicKey, client);
        }
    });
    emptyNamespace.on('connection', async (client) => {
        const auth = !!client.handshake.auth.key;
        const clientPublicKey = auth
            ? await importClientPublicKey(client)
            : undefined;
        if (clientPublicKey) {
            await initChallengeEndpoint(clientPublicKey, client);
        }
    });
    mainNamespace.on('connection', async (client) => {
        const auth = !!client.handshake.auth.key;
        const clientPublicKey = auth
            ? await importClientPublicKey(client)
            : undefined;
        await initDataEndpoint(socketServerUrl, clientPublicKey, client, true);
        if (clientPublicKey) {
            await initChallengeEndpoint(clientPublicKey, client);
        }
    });
    secondaryNamespace.on('connection', async (client) => {
        const auth = !!client.handshake.auth.key;
        const clientPublicKey = auth
            ? await importClientPublicKey(client)
            : undefined;
        await initDataEndpoint(
            secondarySocketServerUrl,
            clientPublicKey,
            client,
        );
        if (clientPublicKey) {
            await initChallengeEndpoint(clientPublicKey, client);
        }
    });
    httpServer.listen(PORT, () => {
        console.log(`[SME Server] Server started on port ${PORT}`);
    });
    return {
        server: httpServer,
        io: socketServer,
        instanceId: serverInstanceId,
    };
}

export async function stopMockSmeServer() {
    if (socketServer) {
        socketServer.close();
    }
    if (httpServer) {
        await new Promise<void>((resolve) => {
            httpServer.close(() => resolve());
        });
    }
}
