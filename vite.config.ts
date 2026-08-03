import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vite.dev + https://vitest.dev — one config for both.
export default defineConfig({
  plugins: [react()],
  test: {
    // Domain/storage tests are pure TS with injected fakes — no DOM needed.
    environment: 'node',
    // `.tsx` is included deliberately: component tests live beside the code and
    // a glob that silently skipped them would leave the UI guards undefended
    // while the suite still reported green.
    include: ['src/**/*.test.{ts,tsx}'],
    // Only the component tests pay for jsdom; the domain suite stays on node.
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
  },
});
