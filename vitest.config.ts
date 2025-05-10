/// <reference types="vitest" />
import { resolve } from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.spec.ts'],
        setupFiles: ['tests/setup.ts'],
        globalSetup: 'tests/vitest.global-setup.ts',
        testTimeout: 30000,
        hookTimeout: 30000,
        reporters: process.env.CI
            ? [['junit', { outputFile: './junit.xml' }]]
            : ['default'],
        coverage: {
            provider: 'v8',
            reporter: ['json-summary', 'lcov'],
            include: ['src/**/*'],
            reportsDirectory: './coverage',
        },
        deps: {
            optimizer: {
                ssr: {
                    include: ['@tests/**'],
                },
            },
        },
        mockReset: true,
        restoreMocks: true,
        clearMocks: true,
    },
    resolve: {
        alias: {
            '@tests': resolve(__dirname, './tests'),
            'smash-node-lib': resolve(__dirname, './src'),
        },
    },
});
