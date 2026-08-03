import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vite.dev + https://vitest.dev — one config for both.
export default defineConfig({
  plugins: [react()],
  test: {
    // Domain/storage tests are pure TS with injected fakes — no DOM needed.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
