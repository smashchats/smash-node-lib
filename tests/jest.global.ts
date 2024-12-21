import { createServer } from 'node:http';
import { URL as NodeURL } from 'node:url';
import { Server, Socket } from 'socket.io';

const HOSTNAME = 'localhost';
const PORT = 12345;

const API_PATH = 'api';
const WEBSOCKET_PATH = 'socket.io';
const VALID_PATH = 'valid';
const EMPTY_PATH = 'empty';
const QUIET_PATH = 'quiet';

// const log = console.log;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const log = (..._args: unknown[]) => {};

log(`Starting mock SME server on port ${PORT}`);
log(`API path: /${API_PATH}`);
log(`Valid WS path: /${VALID_PATH}`);
log(`Empty WS path: /${EMPTY_PATH}`);
log(`Quiet WS path: /${QUIET_PATH}`);

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

const initChallengeEndpoint = async (
    clientPublicKey: CryptoKey,
    socketClient: Socket,
) => {
    log('Initializing challenge endpoint for client');
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
        log('Successfully derived symmetric key');

        // A random iv is generated and used for encryption
        const iv = crypto.getRandomValues(new Uint8Array(12));
        // A random challenge is generated, used, and stored for access-token-based authentication
        const challenge = crypto.getRandomValues(new Uint8Array(12));

        const ivBuf = Buffer.from(iv);
        const challengeBuf = Buffer.from(challenge);

        // The iv and the message are used to create an encrypted series of bits.
        const encryptedChallenge = await subtle.encrypt(
            {
                ...SME_CONFIG.encryptionAlgorithm,
                iv: iv,
            },
            symKey,
            challengeBuf,
        );
        log('Successfully encrypted challenge');

        const encryptedChallengeBuf = Buffer.from(encryptedChallenge);

        socketClient.on(
            'register',
            async (_: unknown, ack: () => void | undefined) => {
                log('Client registration received');
                ack();
                log('Registration acknowledged');
            },
        );

        socketClient.emit('challenge', {
            iv: ivBuf.toString(SME_CONFIG.challengeEncoding),
            challenge: encryptedChallengeBuf.toString(
                SME_CONFIG.challengeEncoding,
            ),
        });
        log('Challenge emitted to client');
    } catch (error) {
        console.error('Error in initChallengeEndpoint:', error);
    }
};

const exportKey = async (key: CryptoKey, encoding = ENCODING) => {
    try {
        const exported = Buffer.from(
            await subtle.exportKey(EXPORTABLE, key),
        ).toString(encoding);
        log('Successfully exported key');
        return exported;
    } catch (error) {
        console.error('Error exporting key:', error);
        throw error;
    }
};

const importKey = async (
    keyEncoded: string,
    keyAlgorithm: KeyAlgorithm,
    exportable = true,
    usages: KeyUsage[] = [],
    encoding: BufferEncoding = ENCODING,
    format: Exclude<KeyFormat, 'jwk'> = EXPORTABLE,
) => {
    try {
        const imported = await subtle.importKey(
            format,
            Buffer.from(keyEncoded, encoding),
            keyAlgorithm,
            exportable,
            usages,
        );
        log('Successfully imported key');
        return imported;
    } catch (error) {
        console.error('Error importing key:', error);
        throw error;
    }
};

const importClientPublicKey = async (socket: Socket) => {
    log('Importing client public key');
    return await importKey(
        socket.handshake.auth.key,
        socket.handshake.auth.keyAlgorithm,
    );
};

const getPeerIdFromUrl = (reqUrl: string) => {
    const url = new NodeURL(reqUrl, 'http://localhost');
    const peerId = url.searchParams.get('peerId');
    log(`Extracted peerId from URL: ${peerId}`);
    return peerId;
};

export default async function setup(): Promise<void> {
    return new Promise((resolve) => {
        const activeSockets: Record<string, Socket> = {};
        const messagesToDelay: Record<string, number> = {};
        const dataEvents: {
            peerId: string;
            sessionId: string;
            data: unknown;
            endpoint: string;
        }[] = [];

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
                log(`Client identified as: ${clientKeyId}`);
                activeSockets[clientKeyId] = client;

                client.on('disconnect', async () => {
                    log(`Client ${clientKeyId} disconnected`);
                    delete activeSockets[clientKeyId];
                    log(`Removed ${clientKeyId} from active sockets`);
                });
            } else {
                log(`Anonymous client`);
            }

            client.on(
                'data',
                async (
                    peerId: string,
                    sessionId: string,
                    data: unknown,
                    acknowledge: () => void | undefined,
                ) => {
                    log(`>> data: ${clientKeyId} --> ${peerId} (${sessionId})`);
                    if (!activeSockets[peerId]) {
                        log(`No active socket found for peer ${peerId}`);
                        return;
                    }
                    let delayMs = 0;
                    if (messagesToDelay[peerId]) {
                        delayMs = messagesToDelay[peerId] * 250;
                        messagesToDelay[peerId] = messagesToDelay[peerId] - 1;
                        log(
                            `Delaying message to peer ${peerId} by ${delayMs}ms`,
                        );
                    }
                    dataEvents.push({ peerId, sessionId, data, endpoint });
                    log(`Queued data event for peer ${peerId}`);
                    setTimeout(() => {
                        log(`Emitting delayed data to peer ${peerId}`);
                        activeSockets[peerId].emit('data', sessionId, data);
                    }, delayMs);
                    if (shouldAck) {
                        acknowledge();
                        log('Data acknowledged');
                    }
                },
            );
        };

        const httpServer = createServer((req, res) => {
            log(`Received ${req.method} request for ${req.url}`);

            // Add this debug log for upgrade requests
            if (req.headers.upgrade === 'websocket') {
                log('Received WebSocket upgrade request:', {
                    url: req.url,
                    headers: req.headers,
                });
            }

            // Enable CORS
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE');

            // Handle preflight requests
            if (req.method === 'OPTIONS') {
                log('Handling OPTIONS request');
                res.writeHead(204);
                res.end();
                return;
            }

            if (
                req.method === 'GET' &&
                req.url?.startsWith(`/${API_PATH}/delay-next-messages`)
            ) {
                log('Handling GET /delay-next-messages request');
                const peerId = getPeerIdFromUrl(req.url);
                if (!peerId) {
                    log('Missing peerId parameter');
                    res.writeHead(400);
                    res.end('Missing peerId parameter');
                    return;
                }
                messagesToDelay[peerId] = 10;
                log(
                    `Set delay for peerId ${peerId}: ${messagesToDelay[peerId]} messages`,
                );
                res.writeHead(200);
                res.end();
                return;
            }

            if (
                req.method === 'GET' &&
                req.url?.startsWith(`/${API_PATH}/data-events`)
            ) {
                log('Handling GET /data-events request');
                const peerId = getPeerIdFromUrl(req.url);
                const filteredEvents = peerId
                    ? dataEvents.filter((event) => event.peerId === peerId)
                    : dataEvents;
                log(`Returning ${filteredEvents.length} events`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(filteredEvents));
                return;
            }

            if (
                req.method === 'DELETE' &&
                req.url?.startsWith(`/${API_PATH}/data-events`)
            ) {
                log('Handling DELETE /data-events request');
                const peerId = getPeerIdFromUrl(req.url);
                if (peerId) {
                    let index = dataEvents.length;
                    let deletedCount = 0;
                    while (index--) {
                        if (dataEvents[index].peerId === peerId) {
                            dataEvents.splice(index, 1);
                            deletedCount++;
                        }
                    }
                    log(`Deleted ${deletedCount} events for peerId ${peerId}`);
                } else {
                    log(`Clearing all ${dataEvents.length} events`);
                    dataEvents.length = 0;
                }
                res.writeHead(200);
                res.end(JSON.stringify(dataEvents));
                return;
            }

            // Handle unknown routes
            log(`Unknown route: ${req.method} ${req.url}`);
            res.writeHead(404);
            res.end('Not found');
        });

        // Also add this to catch upgrade events
        httpServer.on('upgrade', (req) => {
            log('Upgrade request received:', {
                url: req.url,
                headers: req.headers,
            });
        });

        const socketServer = new Server(httpServer, {
            path: `/${WEBSOCKET_PATH}`,
            cors: {
                origin: '*',
                methods: ['GET', 'POST', 'DELETE'],
            },
        });

        log('Socket.IO server created with config:', {
            path: socketServer.path(),
        });

        socketServer.on('connection_error', (err) => {
            console.error('Socket.IO connection error:', err);
        });

        socketServer.on('connect_error', (err) => {
            console.error('Socket.IO connect error:', err);
        });

        const mainNamespace = socketServer.of('/' + VALID_PATH);
        const emptyNamespace = socketServer.of('/' + EMPTY_PATH);
        const quietNamespace = socketServer.of('/' + QUIET_PATH);

        quietNamespace.on('connection', async (client) => {
            log('>>> New connection on quiet namespace');
            const auth = !!client.handshake.auth.key;
            log('> Client authentication:', auth ? 'present' : 'absent');
            const clientPublicKey = auth
                ? await importClientPublicKey(client)
                : undefined;
            log('>> Initializing data endpoint without ack');
            await initDataEndpoint('quiet', clientPublicKey, client, false);
            if (clientPublicKey) {
                log('>> Initializing challenge');
                await initChallengeEndpoint(clientPublicKey, client);
            }
        });

        emptyNamespace.on('connection', async (client) => {
            log('>>> New connection on empty namespace');
            const auth = !!client.handshake.auth.key;
            log('> Client authentication:', auth ? 'present' : 'absent');
            const clientPublicKey = auth
                ? await importClientPublicKey(client)
                : undefined;
            if (clientPublicKey) {
                log('>> Initializing challenge for authenticated client');
                await initChallengeEndpoint(clientPublicKey, client);
            }
        });

        mainNamespace.on('connection', async (client) => {
            log('>>> New connection on main namespace');
            const auth = !!client.handshake.auth.key;
            log('> Client authentication:', auth ? 'present' : 'absent');
            const clientPublicKey = auth
                ? await importClientPublicKey(client)
                : undefined;

            log('>> Initializing data endpoint');
            await initDataEndpoint('main', clientPublicKey, client);
            if (clientPublicKey) {
                log('>> Initializing challenge');
                await initChallengeEndpoint(clientPublicKey, client);
            }
        });

        httpServer.listen(PORT, () => {
            log(`HTTP server listening on port ${PORT}`);
            (
                globalThis as unknown as { __socketServer: Server }
            ).__socketServer = socketServer;
            resolve();
        });
    });
}

export const apiServerUrl = `http://${HOSTNAME}:${PORT}/${API_PATH}`;
export const socketServerUrl = `http://${HOSTNAME}:${PORT}/${VALID_PATH}`;
export const emptySocketServerUrl = `http://${HOSTNAME}:${PORT}/${EMPTY_PATH}`;
export const quietSocketServerUrl = `http://${HOSTNAME}:${PORT}/${QUIET_PATH}`;
