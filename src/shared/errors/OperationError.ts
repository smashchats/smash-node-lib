export class OperationError extends Error {
    constructor(
        message: string,
        public cause?: string,
    ) {
        super(message);
        this.name = 'OperationError';
    }

    static isOperationError(error: unknown): boolean {
        return (
            typeof error === 'object' &&
            error !== null &&
            'name' in error &&
            error.name === 'OperationError'
        );
    }
}
