/* eslint-disable no-undef */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createServer } = require('node:http');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Server } = require('socket.io');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { URL: NodeURL } = require('node:url');

const PORT = 12345;

const API_PATH = 'api';
const WEBSOCKET_PATH = 'socket.io';
const VALID_PATH = 'valid';
const EMPTY_PATH = 'empty';

// const log = console.log;
const log = () => {};

log(`Starting mock SME server on port ${PORT}`);
log(`API path: /${API_PATH}`);
log(`Valid WS path: /${WEBSOCKET_PATH}/${VALID_PATH}`);
log(`Empty WS path: /${WEBSOCKET_PATH}/${EMPTY_PATH}`);

const subtle = globalThis.crypto.subtle;

const ENCODING = 'base64';
const EXPORTABLE = 'spki';

const SME_PUBLIC_KEY =
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEg6rwXUOg3N18rZlQRS8sCmKGuB4opGtTXvYi7DkXltVzK0rEVd91HgM7L9YEyTsM9ntJ8Ye+rHey0LiUZwFwAw==';
const SME_PRIVATE_KEY =
    'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgeDOtDxdjN36dlxG7Z2Rh3E41crFpQEse0xaxBlaVRRWhRANCAASDqvBdQ6Dc3XytmVBFLywKYoa4Hiika1Ne9iLsOReW1XMrSsRV33UeAzsv1gTJOwz2e0nxh76sd7LQuJRnAXAD';
const SME_CONFIG = {
    keyAlgorithm: { name: 'ECDH', namedCurve: 'P-256' },
    encryptionAlgorithm: { name: 'AES-GCM', length: 256 },
    challengeEncoding: 'base64',
};
const KEY_ALGORITHM = {
    name: 'ECDH',
    namedCurve: 'P-256',
};
const KEY_USAGES = ['deriveBits', 'deriveKey'];

const initChallengeEndpoint = async (clientPublicKey, socketClient) => {
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

        socketClient.on('register', async (_, ack) => {
            log('Client registration received');
            ack();
            log('Registration acknowledged');
        });

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

const exportKey = async (key, encoding = ENCODING) => {
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
    keyEncoded,
    keyAlgorithm,
    exportable = true,
    usages = [],
    encoding = ENCODING,
    format = EXPORTABLE,
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

const importClientPublicKey = async (socket) => {
    log('Importing client public key');
    return await importKey(
        socket.handshake.auth.key,
        socket.handshake.auth.keyAlgorithm,
    );
};

const getPeerIdFromUrl = (reqUrl) => {
    const url = new NodeURL(reqUrl, 'http://localhost');
    const peerId = url.searchParams.get('peerId');
    log(`Extracted peerId from URL: ${peerId}`);
    return peerId;
};

module.exports = async function () {
    return new Promise((resolve) => {
        const activeSockets = {};
        const messagesToDelay = {};
        const dataEvents = [];
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
                req.url.startsWith(`/${API_PATH}/delay-next-messages`)
            ) {
                log('Handling GET /delay-next-messages request');
                const peerId = getPeerIdFromUrl(req.url);
                if (!peerId) {
                    console.warn('Missing peerId parameter');
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
                req.url.startsWith(`/${API_PATH}/data-events`)
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
                req.url.startsWith(`/${API_PATH}/data-events`)
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

        emptyNamespace.on('connection', async (client) => {
            log('New connection on empty namespace');
            const auth = !!client.handshake.auth.key;
            log('Client authentication:', auth ? 'present' : 'absent');
            const clientPublicKey = auth
                ? await importClientPublicKey(client)
                : undefined;
            if (clientPublicKey) {
                log('Initializing challenge for authenticated client');
                await initChallengeEndpoint(clientPublicKey, client);
            }
        });

        mainNamespace.on('connection', async (client) => {
            log('New connection on main namespace');
            const auth = !!client.handshake.auth.key;
            log('Client authentication:', auth ? 'present' : 'absent');
            const clientPublicKey = auth
                ? await importClientPublicKey(client)
                : undefined;
            const clientKeyId = auth
                ? await exportKey(clientPublicKey)
                : 'ANONYMOUS';
            log(`Client identified as: ${clientKeyId}`);
            activeSockets[clientKeyId] = client;

            client.on('data', async (peerId, sessionId, data, acknowledge) => {
                log(`Received data for peer ${peerId}, session ${sessionId}`);
                if (!activeSockets[peerId]) {
                    console.warn(`No active socket found for peer ${peerId}`);
                    return;
                }
                let delayMs = 0;
                if (messagesToDelay[peerId]) {
                    delayMs = messagesToDelay[peerId] * 250;
                    messagesToDelay[peerId] = messagesToDelay[peerId] - 1;
                    log(`Delaying message to peer ${peerId} by ${delayMs}ms`);
                }
                dataEvents.push({ peerId, sessionId, data });
                log(`Queued data event for peer ${peerId}`);
                setTimeout(() => {
                    log(`Emitting delayed data to peer ${peerId}`);
                    activeSockets[peerId].emit('data', sessionId, data);
                }, delayMs);
                acknowledge();
                log('Data acknowledged');
            });

            client.on('disconnect', async () => {
                log(`Client ${clientKeyId} disconnected`);
                delete activeSockets[clientKeyId];
                log(`Removed ${clientKeyId} from active sockets`);
            });

            if (clientPublicKey) {
                log('Initializing challenge for authenticated client');
                await initChallengeEndpoint(clientPublicKey, client);
            }
        });

        httpServer.listen(PORT, () => {
            log(`HTTP server listening on port ${PORT}`);
            globalThis.__socketServer = socketServer;
            resolve(void 0);
        });
    });
};

module.exports.apiServerUrl = `http://localhost:${PORT}/${API_PATH}`;
module.exports.socketServerUrl = `http://localhost:${PORT}/${VALID_PATH}`;
module.exports.emptySocketServerUrl = `http://localhost:${PORT}/${EMPTY_PATH}`;
module.exports.SME_PUBLIC_KEY = SME_PUBLIC_KEY;
