import { EventEmitter } from 'events';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export class Logger extends EventEmitter {
    private static readonly MAX_STRING_LENGTH = 72;

    constructor(
        private readonly logID: string = 'Logger',
        private readonly logLevel: LogLevel = 'INFO',
    ) {
        super();
    }

    private shouldLog(level: LogLevel): boolean {
        const levels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
        return levels.indexOf(level) >= levels.indexOf(this.logLevel);
    }

    private shortenLongFields(obj: unknown): unknown {
        if (typeof obj === 'string') {
            return obj.length > Logger.MAX_STRING_LENGTH
                ? `${obj.substring(0, Logger.MAX_STRING_LENGTH)}...`
                : obj;
        }

        if (Array.isArray(obj)) {
            return obj.map((item) => this.shortenLongFields(item));
        }

        if (obj && typeof obj === 'object') {
            const result: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.shortenLongFields(value);
            }
            return result;
        }

        return obj;
    }

    private formatMessage(message: unknown): string {
        if (typeof message === 'string') {
            return message;
        }
        return JSON.stringify(this.shortenLongFields(message), null, 2);
    }

    private log(level: LogLevel, message: unknown, ...args: unknown[]): void {
        if (
            this.shouldLog(level) &&
            typeof globalThis.console !== 'undefined'
        ) {
            const timestamp = new Date().toISOString();
            const formattedMessage = `[${this.logID}] [${timestamp}] [${level}] ${this.formatMessage(message)}`;

            // Color codes for different log levels
            const colors = {
                ERROR: '\x1b[31m',
                WARN: '\x1b[33m',
                INFO: '\x1b[36m',
                DEBUG: '\x1b[90m',
            };

            const colorCode = colors[level];
            const resetCode = '\x1b[0m';

            // Apply color to both message and args
            const coloredArgs = args.map(
                (arg) => `${colorCode}${this.formatMessage(arg)}${resetCode}`,
            );

            switch (level) {
                case 'ERROR':
                    globalThis.console.error(
                        colorCode + formattedMessage,
                        ...coloredArgs,
                    );
                    break;
                case 'WARN':
                    globalThis.console.warn(
                        colorCode + formattedMessage,
                        ...coloredArgs,
                    );
                    break;
                case 'INFO':
                    globalThis.console.info(
                        colorCode + formattedMessage,
                        ...coloredArgs,
                    );
                    break;
                case 'DEBUG':
                    globalThis.console.debug(
                        colorCode + formattedMessage,
                        ...coloredArgs,
                    );
                    break;
            }

            this.emit('log', {
                level,
                message: this.shortenLongFields(message),
                args: this.shortenLongFields(args),
                timestamp,
            });
        }
    }

    debug(message: unknown, ...args: unknown[]): void {
        this.log('DEBUG', message, ...args);
    }

    info(message: unknown, ...args: unknown[]): void {
        this.log('INFO', message, ...args);
    }

    warn(message: unknown, ...args: unknown[]): void {
        this.log('WARN', message, ...args);
    }

    error(message: unknown, ...args: unknown[]): void {
        this.log('ERROR', message, ...args);
    }
}
