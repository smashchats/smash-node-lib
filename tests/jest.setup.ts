import { TIMEOUT_MS } from '@tests/time.utils.js';
import { Logger, SmashMessaging } from 'smash-node-lib';

const logger = new Logger('JEST');

jest.setTimeout(TIMEOUT_MS);

beforeAll(() =>
    (process as any).original.removeAllListeners('unhandledRejection'),
);
beforeEach(() =>
    (process as any).original.on(
        'unhandledRejection',
        (reason: any, promise: Promise<any>) => {
            SmashMessaging.handleError(reason, promise, logger);
        },
    ),
);
