import { EventEmitter } from 'events';
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

export const TIMEOUT_MS = 6000;

let eventWaiterId = 0;
export async function waitForEvent(
    cancellationFunctions: Function[],
    emitter: EventEmitter | Socket,
    eventName: string,
    count: number = 1,
    timeout: number = TIMEOUT_MS - 500,
): Promise<void> {
    const id = (eventWaiterId += 1);
    let eventsReceived = 0;
    const [timeoutPromise, cancelTimeout] = createCancellableDelay(timeout);
    cancellationFunctions.push(cancelTimeout);
    console.log(
        `<<< Waiting for ${eventName}, ID: ${id}, Timeout: ${timeout}ms`,
    );

    return Promise.race([
        timeoutPromise.then(() => {
            console.warn(
                `<<< Timeout (${timeout}ms) while waiting for "${eventName}", ID: ${id}`,
            );
        }),
        new Promise<void>((resolve) => {
            (emitter as Socket).on(eventName, () => {
                eventsReceived++;
                if (eventsReceived === count) {
                    console.log(
                        `<<< Event "${eventName}" received ${eventsReceived} times, ID: ${id}`,
                    );
                    cancelTimeout();
                    resolve();
                }
            });
        }),
    ]);
}

export function aliasWaitFor(fns: Function[]) {
    return (
        ...args: [
            emitter: EventEmitter | Socket,
            eventName: string,
            count?: number,
            timeout?: number,
        ]
    ) => waitForEvent(fns, ...args);
}
