import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
    ...base,
    projects: [{ name: 'msedge', use: { ...devices['Desktop Edge'], channel: 'msedge' } }],
    workers: 1,
    retries: 0,
    reporter: 'list',
    webServer: {
        ...base.webServer,
        command: 'node node_modules/vite/bin/vite.js --port 5174 --strictPort',
    },
});
