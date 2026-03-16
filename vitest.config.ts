/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Environment
    environment: 'jsdom',
    globals: true,

    // Setup
    setupFiles: ['./src/test/setup.ts'],

    // File patterns
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'legacy', 'e2e'],

    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/types/**',
      ],
      thresholds: {
        statements: 60,
        branches: 60,
        functions: 60,
        lines: 60,
      },
    },

    // Performance
    pool: 'forks',
    reporters: ['default'],
    passWithNoTests: false,
  },
});
