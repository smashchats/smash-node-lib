import { Server } from 'socket.io';

export default async function teardown() {
    (
        globalThis as unknown as { __socketServer: Server }
    ).__socketServer.close();
    console.debug('>>> closing socket server <<<');
}
