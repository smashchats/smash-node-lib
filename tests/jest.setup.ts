import { Logger, SmashMessaging } from 'smash-node-lib';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { TIMEOUT_MS, delay } from './time.utils';

const logger = new Logger('jest', 'INFO');
jest.setTimeout(TIMEOUT_MS);
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
    await delay(1500);
});
