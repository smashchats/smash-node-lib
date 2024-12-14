import { EventEmitter } from 'events';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export class Logger extends EventEmitter {
    constructor(
        private logID: string = 'Logger',
        private logLevel: LogLevel = 'INFO',
    ) {
        super();
    }

    private shouldLog(level: LogLevel): boolean {
        const levels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
        return levels.indexOf(level) >= levels.indexOf(this.logLevel);
    }

    private log(level: LogLevel, message: string, ...args: unknown[]): void {
        if (
            this.shouldLog(level) &&
            typeof globalThis.console !== 'undefined'
        ) {
            const timestamp = new Date().toISOString();
            const formattedMessage = `[${this.logID}] [${timestamp}] [${level}] ${message}`;

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
                (arg) => `${colorCode}${arg}${resetCode}`,
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

            this.emit('log', { level, message, args, timestamp });
        }
    }

    debug(message: string, ...args: unknown[]): void {
        this.log('DEBUG', message, ...args);
    }

    info(message: string, ...args: unknown[]): void {
        this.log('INFO', message, ...args);
    }

    warn(message: string, ...args: unknown[]): void {
        this.log('WARN', message, ...args);
    }

    error(message: string, ...args: unknown[]): void {
        this.log('ERROR', message, ...args);
    }
}
