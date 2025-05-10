import {
    startMockSmeServer,
    stopMockSmeServer,
} from '@tests/vitest.sme-server.js';

export default async function globalSetup() {
    startMockSmeServer();
    return async () => {
        await stopMockSmeServer();
    };
}
