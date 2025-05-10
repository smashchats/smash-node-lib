import { TEST_CONFIG, delay } from '@tests/utils/time.utils.js';
import { apiServerUrl } from '@tests/vitest.sme-server.js';
import { Logger } from 'smash-node-lib';

export interface TestMessage {
    text: string;
    sha256?: string;
}

export class TestUtils {
    static async getDataEvents(
        logger: Logger,
        peerId: string,
        method: 'GET' | 'DELETE' = 'GET',
    ): Promise<unknown[]> {
        const url = `${apiServerUrl}/data-events?peerId=${encodeURIComponent(peerId)}`;
        logger.debug(`[TestUtils.getDataEvents] Fetching URL: ${url}`);
        try {
            const response = await fetch(url, { method });
            if (!response.ok) {
                logger.error(`Error response: ${await response.text()}`);
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const json = (await response.json()) as unknown[];
            logger.debug(
                `[TestUtils.getDataEvents] peerId: ${peerId}, method: ${method}, response:`,
                json.length,
            );
            return json;
        } catch (error) {
            logger.error('Fetch error:', error);
            return [];
        }
    }

    static async pollForDataEvent(
        logger: Logger,
        peerId: string,
        maxAttempts = TEST_CONFIG.DEFAULT_POLL_ATTEMPTS,
        interval = TEST_CONFIG.DEFAULT_POLL_INTERVAL,
    ): Promise<unknown[]> {
        logger.info(
            `[TestUtils] Starting pollForDataEvent for peerId: ${peerId}`,
        );
        logger.debug(
            `[TestUtils] Max attempts: ${maxAttempts}, Interval: ${interval}ms`,
        );
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            logger.debug(
                `[TestUtils] Polling attempt ${attempt + 1}/${maxAttempts}`,
            );
            const events = await TestUtils.getDataEvents(logger, peerId);
            logger.debug(`[TestUtils] Received events:`, events.length);
            if (events.length > 0) {
                logger.info(
                    `[TestUtils] Found ${events.length} events, returning`,
                );
                return events;
            }
            logger.debug(
                `[TestUtils] No events found, waiting ${interval}ms before next attempt`,
            );
            await delay(interval);
        }
        logger.warn(
            `[TestUtils] Polling timed out after ${maxAttempts} attempts`,
        );
        throw new Error('Timeout waiting for SME data event');
    }
}
