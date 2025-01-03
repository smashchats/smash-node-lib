import { apiServerUrl } from '@tests/jest.global.js';
import { delay } from '@tests/time.utils.js';
import { TEST_CONFIG } from '@tests/time.utils.js';
import { Logger } from 'smash-node-lib';

export interface TestMessage {
    text: string;
    sha256?: string;
}

export class TestUtils {
    public static logger: Logger | undefined;

    static async getDataEvents(
        peerId: string,
        method: 'GET' | 'DELETE' = 'GET',
    ): Promise<unknown[]> {
        const url = `${apiServerUrl}/data-events?peerId=${encodeURIComponent(peerId)}`;
        try {
            const response = await fetch(url, { method });
            if (!response.ok) {
                this.logger?.error(`Error response: ${await response.text()}`);
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            this.logger?.error('Fetch error:', error);
            throw error;
        }
    }

    static async pollForDataEvent(
        peerId: string,
        maxAttempts = TEST_CONFIG.DEFAULT_POLL_ATTEMPTS,
        interval = TEST_CONFIG.DEFAULT_POLL_INTERVAL,
    ): Promise<unknown[]> {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            this.logger?.debug(`Polling attempt ${attempt + 1}/${maxAttempts}`);
            const events = await this.getDataEvents(peerId);
            if (events.length > 0) {
                this.logger?.debug(`Found ${events.length} events`);
                return events;
            }
            await delay(interval);
        }
        throw new Error('Timeout waiting for SME data event');
    }
}
