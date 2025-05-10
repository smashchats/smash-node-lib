import { TEST_CONFIG, delay } from '@tests/utils/time.utils.js';
import { Logger, SmashMessaging } from 'smash-node-lib';
import { afterAll, beforeAll, beforeEach } from 'vitest';

const logger = new Logger('vitest', 'INFO');
process.setMaxListeners(100);

beforeAll(() => {
    logger.debug('>>> removing unhandledRejection listeners <<<');
    process.removeAllListeners('unhandledRejection');
});

beforeEach(() => {
    logger.debug('>>> adding unhandledRejection listener <<<');
    process.on(
        'unhandledRejection',
        (reason: unknown, promise: Promise<unknown>) => {
            SmashMessaging.handleError(reason, promise, logger);
        },
    );
});

afterAll(async () => {
    await delay(TEST_CONFIG.DEFAULT_SETUP_DELAY);
});
