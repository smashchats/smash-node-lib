import { Logger, SmashMessaging } from 'smash-node-lib';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { TIMEOUT_MS } from './time.utils';

const logger = new Logger('jest', 'INFO');
jest.setTimeout(TIMEOUT_MS);

type Process = NodeJS.Process & { actual: NodeJS.Process };

beforeAll(() => {
    console.log('>>> removing unhandledRejection listeners <<<');
    (process as Process).actual.removeAllListeners('unhandledRejection');
});

beforeEach(() => {
    (process as Process).actual.on(
        'unhandledRejection',
        (reason: unknown, promise: Promise<unknown>) => {
            SmashMessaging.handleError(reason, promise, logger);
        },
    );
});
