import { Logger } from '@src/Logger.js';
import { SmashMessaging } from 'smash-node-lib';

const logger = new Logger('JEST');

beforeAll(() =>
    (process as any).actual().removeAllListeners('unhandledRejection'),
);
beforeEach(() =>
    (process as any)
        .actual()
        .on('unhandledRejection', (reason: any, promise: Promise<any>) => {
            SmashMessaging.handleError(reason, promise, logger);
        }),
);
