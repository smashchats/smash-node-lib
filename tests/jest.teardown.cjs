/* eslint-disable no-undef */
module.exports = function () {
    globalThis.__socketServer.close();
    console.debug('>>> closing socket server <<<');
};
