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

    private log(level: LogLevel, message: string, ...args: any[]): void {
        if (this.shouldLog(level)) {
            const timestamp = new Date().toISOString();
            console[level.toLowerCase() as 'log' | 'info' | 'warn' | 'error'](
                `[${this.logID}] [${timestamp}] [${level}] ${message}`,
                ...args,
            );
            this.emit('log', { level, message, args, timestamp });
        }
    }

    debug(message: string, ...args: any[]): void {
        this.log('DEBUG', message, ...args);
    }

    info(message: string, ...args: any[]): void {
        this.log('INFO', message, ...args);
    }

    warn(message: string, ...args: any[]): void {
        this.log('WARN', message, ...args);
    }

    error(message: string, ...args: any[]): void {
        this.log('ERROR', message, ...args);
    }
}
