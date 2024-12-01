/* eslint-disable no-undef */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createServer } = require('node:http');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Server } = require('socket.io');

const PORT = 12345;
const URL = `http://localhost:${PORT}`;

const subtle = globalThis.crypto.subtle;

const ENCODING = 'base64';
const EXPORTABLE = 'spki';

const exportKey = async (key, encoding = ENCODING) =>
    Buffer.from(await subtle.exportKey(EXPORTABLE, key)).toString(encoding);

const importKey = async (
    keyEncoded,
    keyAlgorithm,
    exportable = true,
    usages = [],
    encoding = ENCODING,
) =>
    await subtle.importKey(
        EXPORTABLE,
        Buffer.from(keyEncoded, encoding),
        keyAlgorithm,
        exportable,
        usages,
    );

const importClientPublicKey = async (socket) =>
    await importKey(
        socket.handshake.auth.key,
        socket.handshake.auth.keyAlgorithm,
    );

let messagesToDelay = 0;

module.exports = async function () {
    return new Promise((resolve) => {
        const activeSockets = {};
        const dataEvents = [];
        const httpServer = createServer((req, res) => {
            console.log(`Received ${req.method} request for ${req.url}`);

            // Enable CORS
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE');

            // Handle preflight requests
            if (req.method === 'OPTIONS') {
                console.log('Handling OPTIONS request');
                res.writeHead(204);
                res.end();
                return;
            }

            if (req.method === 'GET' && req.url === '/delay-next-5-messages') {
                console.log('Handling GET /delay-next-5-messages request');
                messagesToDelay = 5;
                res.writeHead(200);
                res.end();
                return;
            }

            if (req.method === 'GET' && req.url === '/data-events') {
                console.log('Handling GET /data-events request');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(dataEvents));
                return;
            }

            if (req.method === 'DELETE' && req.url === '/data-events') {
                console.log('Handling DELETE /data-events request');
                dataEvents.length = 0;
                console.log('Events cleared');
                res.writeHead(200);
                res.end();
                return;
            }

            // Handle unknown routes
            console.log(`Unknown route: ${req.method} ${req.url}`);
            res.writeHead(404);
            res.end('Not found');
        });

        const socketServer = new Server(httpServer, {
            // Socket.IO config
            cors: {
                origin: '*',
                methods: ['GET', 'POST', 'DELETE'],
            },
        });

        socketServer.on('connection', async (client) => {
            const auth = !!client.handshake.auth.key;
            const clientPublicKey = auth
                ? await importClientPublicKey(client)
                : undefined;
            const clientKeyId = auth
                ? await exportKey(clientPublicKey)
                : 'ANONYMOUS';
            activeSockets[clientKeyId] = client;
            client.on('data', async (peerId, sessionId, data, acknowledge) => {
                let delayMs = 0;
                if (messagesToDelay > 0) {
                    delayMs = messagesToDelay * 100;
                    messagesToDelay = messagesToDelay - 1;
                    console.log(`Delaying SME message for ${delayMs}ms`);
                }
                dataEvents.push({ peerId, sessionId, data });
                Object.keys(activeSockets)
                    .filter((key) => peerId === key)
                    .forEach((key) =>
                        setTimeout(
                            () =>
                                activeSockets[key].emit(
                                    'data',
                                    sessionId,
                                    data,
                                ),
                            delayMs,
                        ),
                    );
                acknowledge();
            });
            client.on('disconnect', async () => {
                delete activeSockets[clientKeyId];
            });
        });

        httpServer.listen(PORT, () => {
            globalThis.__socketServer = socketServer;
            resolve(void 0);
        });
    });
};

module.exports.socketServerUrl = URL;
