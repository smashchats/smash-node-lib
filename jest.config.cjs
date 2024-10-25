/** @type {import('ts-jest').JestConfigWithTsJest} **/

const actualProcess = process;
process.actual = () => actualProcess;

module.exports = {
    preset: 'ts-jest/presets/default-esm',
    moduleFileExtensions: ['ts', 'js', 'json'],
    testEnvironment: 'node',
    rootDir: './',
    coverageDirectory: './coverage',
    testMatch: ['<rootDir>/tests/**/*.spec.ts'],
    testPathIgnorePatterns: ['node_modules'],
    moduleNameMapper: {
        '^@src/(.*)\\.js$': '<rootDir>/src/$1.ts',
        'smash-node-lib': '<rootDir>/src/index.ts',
    },
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                useESM: true,
            },
        ],
    },
};
