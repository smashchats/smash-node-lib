/** @type {import('ts-jest').JestConfigWithTsJest} **/

// eslint-disable-next-line no-undef
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
        '^@tests/(.*)\\.js$': '<rootDir>/tests/$1.ts',
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
    setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],
    globalSetup: '<rootDir>/tests/jest.global.cjs',
    globalTeardown: '<rootDir>/tests/jest.teardown.cjs',
};
