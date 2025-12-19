import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/types/**',
        'src/**/*.d.ts',
        'src/index.ts',
        'src/lib/**',
        'src/orchestrator/**',
        'src/tools/**',
        'src/workers/**',
        'src/services/*.db.ts',
      ],
      thresholds: {
        global: {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    setupFiles: ['./tests/helpers/setup.ts'],
    env: {
      NODE_ENV: 'test',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/services': path.resolve(__dirname, './src/services'),
      '@/api': path.resolve(__dirname, './src/api'),
      '@/orchestrator': path.resolve(__dirname, './src/orchestrator'),
      '@/tools': path.resolve(__dirname, './src/tools'),
      '@/workers': path.resolve(__dirname, './src/workers'),
      '@/types': path.resolve(__dirname, './src/types'),
      '@/lib': path.resolve(__dirname, './src/lib'),
    },
  },
});
