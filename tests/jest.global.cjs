/* eslint-disable no-undef */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createServer } = require('node:http');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Server } = require('socket.io');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { URL: NodeURL } = require('node:url');

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

const getPeerIdFromUrl = (reqUrl) => {
    const url = new NodeURL(reqUrl, 'http://localhost');
    return url.searchParams.get('peerId');
};

module.exports = async function () {
    return new Promise((resolve) => {
        const activeSockets = {};
        const messagesToDelay = {};
        const dataEvents = [];
        const httpServer = createServer((req, res) => {
            // console.log(`Received ${req.method} request for ${req.url}`);

            // Enable CORS
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE');

            // Handle preflight requests
            if (req.method === 'OPTIONS') {
                // console.log('Handling OPTIONS request');
                res.writeHead(204);
                res.end();
                return;
            }

            if (
                req.method === 'GET' &&
                req.url.startsWith('/delay-next-messages')
            ) {
                // console.log('Handling GET /delay-next-messages request');
                const peerId = getPeerIdFromUrl(req.url);
                if (!peerId) {
                    res.writeHead(400);
                    res.end('Missing peerId parameter');
                    return;
                }
                messagesToDelay[peerId] = 10;
                // console.log(
                //     `Set delay for peerId ${peerId}: ${messagesToDelay[peerId]} messages`,
                // );
                res.writeHead(200);
                res.end();
                return;
            }

            if (req.method === 'GET' && req.url.startsWith('/data-events')) {
                // console.log('Handling GET /data-events request');
                const peerId = getPeerIdFromUrl(req.url);
                const filteredEvents = peerId
                    ? dataEvents.filter((event) => event.peerId === peerId)
                    : dataEvents;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(filteredEvents));
                return;
            }

            if (req.method === 'DELETE' && req.url.startsWith('/data-events')) {
                // console.log('Handling DELETE /data-events request');
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
                // console.log('Events cleared');
                res.writeHead(200);
                res.end(JSON.stringify(dataEvents));
                return;
            }

            // Handle unknown routes
            // console.log(`Unknown route: ${req.method} ${req.url}`);
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
                if (!activeSockets[peerId]) {
                    return;
                }
                let delayMs = 0;
                if (messagesToDelay[peerId]) {
                    delayMs = messagesToDelay[peerId] * 250;
                    messagesToDelay[peerId] = messagesToDelay[peerId] - 1;
                }
                dataEvents.push({ peerId, sessionId, data });
                setTimeout(() => {
                    activeSockets[peerId].emit('data', sessionId, data);
                }, delayMs);
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
