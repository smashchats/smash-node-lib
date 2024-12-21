import { TEST_CONFIG, delay } from '@tests/time.utils.js';
import { Logger, SmashMessaging } from 'smash-node-lib';

const logger = new Logger('jest', 'INFO');
jest.setTimeout(TEST_CONFIG.TEST_TIMEOUT_MS);
(process as Process).actual.setMaxListeners(100);

type Process = NodeJS.Process & { actual: NodeJS.Process };

beforeAll(() => {
    console.debug('>>> removing unhandledRejection listeners <<<');
    (process as Process).actual.removeAllListeners('unhandledRejection');
});

beforeEach(() => {
    console.debug('>>> adding unhandledRejection listener <<<');
    (process as Process).actual.on(
        'unhandledRejection',
        (reason: unknown, promise: Promise<unknown>) => {
            SmashMessaging.handleError(reason, promise, logger);
        },
    );
});

afterAll(async () => {
    await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
});
