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
// const log = console.log;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const log = (...args: unknown[]) => {};

log(`Starting mock SME server on port ${PORT} with hostname ${HOSTNAME}`);
log(`API endpoint path: /${API_PATH}`);
log(`Valid WebSocket namespace path: /${VALID_PATH}`);
log(`Secondary WebSocket namespace path: /${SECONDARY_PATH}`);
log(`Empty WebSocket namespace path: /${EMPTY_PATH}`);
log(`Quiet WebSocket namespace path: /${QUIET_PATH}`);

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

const initChallengeEndpoint = async (
    clientPublicKey: CryptoKey,
    socketClient: Socket,
) => {
    log(
        `Initializing challenge endpoint for client with socket ID: ${socketClient.id}`,
    );
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
        log(
            `Successfully derived symmetric key using ${SME_CONFIG.encryptionAlgorithm.name} algorithm with ${SME_CONFIG.encryptionAlgorithm.length}-bit length`,
        );

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
        log(
            `Successfully encrypted challenge using ${SME_CONFIG.encryptionAlgorithm.name} with IV length: ${iv.length} bytes`,
        );

        const encryptedChallengeBuf = Buffer.from(encryptedChallenge);

        socketClient.on(
            'register',
            async (_: unknown, ack: () => void | undefined) => {
                log(
                    `Client registration received for socket ID: ${socketClient.id}`,
                );
                ack();
                log(
                    `Registration acknowledged for socket ID: ${socketClient.id}`,
                );
            },
        );

        socketClient.emit('challenge', {
            iv: ivBuf.toString(SME_CONFIG.challengeEncoding),
            challenge: encryptedChallengeBuf.toString(
                SME_CONFIG.challengeEncoding,
            ),
        });
        log(
            `Challenge emitted to client (socket ID: ${socketClient.id}) using ${SME_CONFIG.challengeEncoding} encoding`,
        );
    } catch (error) {
        console.error(
            `Error in initChallengeEndpoint for socket ID ${socketClient.id}:`,
            error,
        );
    }
};

const exportKey = async (key: CryptoKey, encoding = ENCODING) => {
    try {
        const exported = Buffer.from(
            await subtle.exportKey(EXPORTABLE, key),
        ).toString(encoding);
        log(
            `Successfully exported key using ${EXPORTABLE} format and ${encoding} encoding`,
        );
        return exported;
    } catch (error) {
        console.error(`Error exporting key with format ${EXPORTABLE}:`, error);
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
        log(
            `Successfully imported key with algorithm ${keyAlgorithm?.name}, format ${format}, usages: [${usages.join(', ')}]`,
        );
        return imported;
    } catch (error) {
        console.error(
            `Error importing key with algorithm ${keyAlgorithm?.name}:`,
            error,
        );
        throw error;
    }
};

const importClientPublicKey = async (socket: Socket) => {
    log(
        `Importing client public key (${socket.handshake.auth.key}) for socket ID ${socket.id} with algorithm ${socket.handshake.auth.keyAlgorithm?.name}, curve: ${socket.handshake.auth.keyAlgorithm?.namedCurve}`,
    );
    return await importKey(
        socket.handshake.auth.key,
        socket.handshake.auth.keyAlgorithm,
    );
};

const getPeerIdFromUrl = (reqUrl: string) => {
    const url = new NodeURL(reqUrl, 'http://localhost');
    const peerId = url.searchParams.get('peerId');
    log(`Extracted peerId from URL ${reqUrl}: ${peerId || 'none'}`);
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
                log(
                    `Client identified with key ID: ${clientKeyId}, socket ID: ${client.id}`,
                );
                activeSockets[clientKeyId] = client;

                client.on('disconnect', async () => {
                    log(
                        `Client ${clientKeyId} disconnected (socket ID: ${client.id})`,
                    );
                    delete activeSockets[clientKeyId];
                    log(
                        `Removed client ${clientKeyId} from active sockets (total active: ${Object.keys(activeSockets).length})`,
                    );
                });
            } else {
                log(`Anonymous client connected with socket ID: ${client.id}`);
            }

            client.on(
                'data',
                async (
                    peerId: string,
                    sessionId: string,
                    data: unknown,
                    acknowledge: () => void | undefined,
                ) => {
                    log(
                        `>> Received data: ${clientKeyId} --> ${peerId} (session: ${sessionId}, endpoint: ${endpoint})`,
                    );
                    if (!activeSockets[peerId]) {
                        log(
                            `No active socket found for peer ${peerId} (total active sockets: ${Object.keys(activeSockets).length})`,
                        );
                        return;
                    }
                    let delayMs = 0;
                    if (messagesToDelay[peerId]) {
                        delayMs = messagesToDelay[peerId] * 250;
                        messagesToDelay[peerId] = messagesToDelay[peerId] - 1;
                        log(
                            `Delaying message to peer ${peerId} by ${delayMs}ms (${messagesToDelay[peerId]} delays remaining)`,
                        );
                    }
                    dataEvents.push({
                        peerId,
                        sessionId,
                        data,
                        endpoint,
                    });
                    log(
                        `Queued data event for peer ${peerId} (total events: ${dataEvents.length})`,
                    );
                    setTimeout(() => {
                        if (!activeSockets[peerId]) {
                            log(
                                `No active socket found for peer ${peerId} (total active sockets: ${Object.keys(activeSockets).length})`,
                            );
                            return;
                        }
                        log(
                            `Emitting data to peer ${peerId} (delay: ${delayMs}ms, session: ${sessionId})`,
                        );
                        activeSockets[peerId].emit('data', sessionId, data);
                    }, delayMs);
                    if (shouldAck) {
                        acknowledge();
                        log(`Data acknowledged for session ${sessionId}`);
                    }
                },
            );
        };

        const httpServer = createServer((req, res) => {
            log(
                `Received ${req.method} request for ${req.url} with headers: ${JSON.stringify(req.headers)}`,
            );

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
                log('Handling OPTIONS request with CORS headers');
                res.writeHead(204);
                res.end();
                return;
            }

            if (
                req.method === 'GET' &&
                req.url?.startsWith(`/${API_PATH}/delay-next-messages`)
            ) {
                log(
                    `Handling GET /delay-next-messages request for URL: ${req.url}`,
                );
                const peerId = getPeerIdFromUrl(req.url);
                if (!peerId) {
                    log(
                        'Missing peerId parameter in delay-next-messages request',
                    );
                    res.writeHead(400);
                    res.end('Missing peerId parameter');
                    return;
                }
                messagesToDelay[peerId] = 10;
                log(
                    `Set delay for peerId ${peerId}: next ${messagesToDelay[peerId]} messages will be delayed`,
                );
                res.writeHead(200);
                res.end();
                return;
            }

            if (
                req.method === 'GET' &&
                req.url?.startsWith(`/${API_PATH}/data-events`)
            ) {
                log(`Handling GET /data-events request for URL: ${req.url}`);
                const peerId = getPeerIdFromUrl(req.url);
                const filteredEvents = peerId
                    ? dataEvents.filter((event) => event.peerId === peerId)
                    : dataEvents;
                log(
                    `Returning ${filteredEvents.length} events${peerId ? ` for peerId ${peerId}` : ' (all events)'}`,
                );
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(filteredEvents));
                return;
            }

            if (
                req.method === 'DELETE' &&
                req.url?.startsWith(`/${API_PATH}/data-events`)
            ) {
                log(`Handling DELETE /data-events request for URL: ${req.url}`);
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
                    log(
                        `Deleted ${deletedCount} events for peerId ${peerId} (remaining events: ${dataEvents.length})`,
                    );
                } else {
                    log(
                        `Clearing all ${dataEvents.length} events from data store`,
                    );
                    dataEvents.length = 0;
                }
                res.writeHead(200);
                res.end(JSON.stringify(dataEvents));
                return;
            }

            // Handle unknown routes
            log(`Unknown route requested: ${req.method} ${req.url}`);
            res.writeHead(404);
            res.end('Not found');
        });

        // Also add this to catch upgrade events
        httpServer.on('upgrade', (req) => {
            log('WebSocket upgrade request received:', {
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

        log('Socket.IO server created with configuration:', {
            path: socketServer.path(),
            cors: 'enabled for all origins',
            methods: ['GET', 'POST', 'DELETE'],
        });

        socketServer.on('connection_error', (err) => {
            console.error('Socket.IO connection error:', err);
        });

        socketServer.on('connect_error', (err) => {
            console.error('Socket.IO connect error:', err);
        });

        const mainNamespace = socketServer.of('/' + VALID_PATH);
        const secondaryNamespace = socketServer.of('/' + SECONDARY_PATH);
        const emptyNamespace = socketServer.of('/' + EMPTY_PATH);
        const quietNamespace = socketServer.of('/' + QUIET_PATH);

        quietNamespace.on('connection', async (client) => {
            log(
                `>>> New connection on quiet namespace (socket ID: ${client.id})`,
            );
            const auth = !!client.handshake.auth.key;
            log(
                `> Client authentication status: ${auth ? 'authenticated' : 'anonymous'}`,
            );
            const clientPublicKey = auth
                ? await importClientPublicKey(client)
                : undefined;
            log('>> Initializing data endpoint without acknowledgment');
            await initDataEndpoint(
                quietSocketServerUrl,
                clientPublicKey,
                client,
                false,
            );
            if (clientPublicKey) {
                log('>> Initializing challenge for authenticated client');
                await initChallengeEndpoint(clientPublicKey, client);
            }
        });

        emptyNamespace.on('connection', async (client) => {
            log(
                `>>> New connection on empty namespace (socket ID: ${client.id})`,
            );
            const auth = !!client.handshake.auth.key;
            log(
                `> Client authentication status: ${auth ? 'authenticated' : 'anonymous'}`,
            );
            const clientPublicKey = auth
                ? await importClientPublicKey(client)
                : undefined;
            if (clientPublicKey) {
                log('>> Initializing challenge for authenticated client');
                await initChallengeEndpoint(clientPublicKey, client);
            }
        });

        mainNamespace.on('connection', async (client) => {
            log(
                `>>> New connection on main namespace (socket ID: ${client.id})`,
            );
            const auth = !!client.handshake.auth.key;
            log(
                `> Client authentication status: ${auth ? 'authenticated' : 'anonymous'}`,
            );
            const clientPublicKey = auth
                ? await importClientPublicKey(client)
                : undefined;

            log('>> Initializing data endpoint with acknowledgment');
            await initDataEndpoint(socketServerUrl, clientPublicKey, client);
            if (clientPublicKey) {
                log('>> Initializing challenge for authenticated client');
                await initChallengeEndpoint(clientPublicKey, client);
            }
        });

        secondaryNamespace.on('connection', async (client) => {
            log(
                `>>> New connection on secondary namespace (socket ID: ${client.id})`,
            );
            const auth = !!client.handshake.auth.key;
            log(
                `> Client authentication status: ${auth ? 'authenticated' : 'anonymous'}`,
            );
            const clientPublicKey = auth
                ? await importClientPublicKey(client)
                : undefined;

            log('>> Initializing data endpoint with acknowledgment');
            await initDataEndpoint(
                secondarySocketServerUrl,
                clientPublicKey,
                client,
            );
            if (clientPublicKey) {
                log('>> Initializing challenge for authenticated client');
                await initChallengeEndpoint(clientPublicKey, client);
            }
        });

        httpServer.listen(PORT, () => {
            log(
                `HTTP server listening on port ${PORT} with Socket.IO server attached`,
            );
            (
                globalThis as unknown as { __socketServer: Server }
            ).__socketServer = socketServer;
            resolve();
        });
    });
}
