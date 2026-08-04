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
    // Gives the Leaflet map container a real size under jsdom, which has no
    // layout engine; a 0x0 container makes fitBounds throw. See the file.
    setupFiles: ['./src/test/setup.ts'],
    // Vitest stubs CSS imports to an empty string by default, which would make
    // mapFit.test.ts's `index.css?raw` assertions vacuously pass. That file is
    // load-bearing — `.map-pane`'s min-width is what keeps the fit padding from
    // exceeding the pane — so it alone is really processed. Left off for
    // leaflet.css and the rest: nothing asserts on those.
    css: { include: [/src\/index\.css/] },
  },
});
