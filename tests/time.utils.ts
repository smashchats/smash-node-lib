import { EventEmitter } from 'events';
import { Logger } from 'smash-node-lib';
import { Socket } from 'socket.io';

export function createCancellableDelay(
    milliseconds: number,
): [Promise<void>, () => void] {
    let resolve: (value: void | PromiseLike<void>) => void;
    const promise = new Promise<void>((res) => {
        resolve = res;
    });
    const timeoutId = setTimeout(resolve!, milliseconds);
    const cancel = () => clearTimeout(timeoutId);
    return [promise, cancel];
}
export async function delay(milliseconds: number): Promise<void> {
    const [delayPromise] = createCancellableDelay(milliseconds);
    return delayPromise;
}

export const TEST_CONFIG = {
    TEST_TIMEOUT_MS: 4500,
    INITIAL_DATE: '2024-01-01T00:00:00.000Z',
    PROTOCOL_OVERHEAD_SIZE: 2,
    MESSAGE_DELIVERY: 550,
    MESSAGE_DELIVERY_TIMEOUT: 15000,
    DEFAULT_SETUP_DELAY: 500,
    DEFAULT_POLL_ATTEMPTS: 20,
    DEFAULT_POLL_INTERVAL: 500,
} as const;

export const TIMEOUT_MS = TEST_CONFIG.TEST_TIMEOUT_MS;

let eventWaiterId = 0;
export async function waitForEvent(
    cancellationFunctions: (() => void)[],
    logger: Logger,
    emitter: EventEmitter | Socket,
    eventName: string,
    params:
        | {
              count?: number;
              timeout?: number;
          }
        | undefined = undefined,
): Promise<void> {
    const id = (eventWaiterId += 1);
    let eventsReceived = 0;
    const { count = 1, timeout = TIMEOUT_MS - 500 } = params || {};
    const [timeoutPromise, cancelTimeout] = createCancellableDelay(timeout);
    cancellationFunctions.push(cancelTimeout);
    logger.info(
        `<<< Waiting for ${eventName}, ID: ${id}, Timeout: ${timeout}ms`,
    );

    return Promise.race([
        timeoutPromise.then(() => {
            logger.warn(
                `<<< Timeout (${timeout}ms) while waiting for "${eventName}", ID: ${id}`,
            );
            throw new Error(
                `Timeout (${timeout}ms) while waiting for "${eventName}", ID: ${id}`,
            );
        }),
        new Promise<void>((resolve) => {
            (emitter as Socket).on(eventName, () => {
                eventsReceived++;
                if (eventsReceived === count) {
                    logger.info(
                        `<<< Event "${eventName}" received ${eventsReceived} times, ID: ${id}`,
                    );
                    cancelTimeout();
                    resolve();
                }
            });
        }),
    ]);
}

export function aliasWaitFor(fns: (() => void)[], logger: Logger) {
    return (
        ...args: Parameters<typeof waitForEvent> extends [
            unknown,
            unknown,
            ...infer Rest,
        ]
            ? Rest
            : never
    ) => waitForEvent(fns, logger, ...args);
}
