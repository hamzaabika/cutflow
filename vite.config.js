import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The page's strict CSP blocks Vite's inline hot-reload client, so it is only applied to builds.
const prodOnlyCsp = {
  name: 'prod-only-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
};

// P2-28 follow-up (2026-11-15): the bundled @fontsource CSS references every
// face twice — a woff2 file AND a legacy .woff fallback. Chromium (the only
// engine that ever runs this app) has supported woff2 since 2016 and takes
// the woff2 URL listed first in each @font-face src, so the .woff files
// (297 files, ~5.4 MB) are never requested — they only bloat dist and the
// installer. Drop them from the emitted bundle; the CSS keeps referencing
// them, which is harmless (the fallback URL is never fetched when woff2
// resolves). The woff2 files stay, and the runtime behaviour is unchanged:
// faces are still lazy-fetched (the browser only downloads a face when it
// is actually used), they just no longer ship a dead fallback alongside.
const dropLegacyWoff = {
  name: 'drop-legacy-woff',
  generateBundle(_options, bundle) {
    for (const [name, chunk] of Object.entries(bundle)) {
      if (name.endsWith('.woff') && chunk.type === 'asset') delete bundle[name];
    }
  },
};

export default defineConfig({
  plugins: [react(), prodOnlyCsp, dropLegacyWoff],
  server: { port: 5173, strictPort: true },
  // Only the app's page: otherwise the dependency scan also crawls build output such as android/build.
  optimizeDeps: { entries: ['index.html'] },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Code-splitting (P2-28): React + React DOM ride in their own chunk, and
    // every React.lazy() panel/dialog (App.jsx, LeftPanel.jsx) plus the
    // lazily-loaded locale catalogs (src/i18n/catalogs.js) get their own
    // chunks, so first paint parses only the editor shell. The font files
    // stay as lazy-fetched assets: @font-face files download only when a
    // face is actually used, and the legacy .woff fallbacks are dropped
    // from the bundle by the dropLegacyWoff plugin above (Chromium only
    // ever takes the woff2 URL listed first), so only the 309 woff2 faces
    // ship. On-demand per-font CSS imports were evaluated and NOT done:
    // Vite still emits the lazily-imported font assets into dist, so total
    // shipped bytes would not drop, and lazy font loading would race the
    // canvas text renderer (preview + export would need a load gate per
    // font). The remaining shipped-font work, if wanted, is a runtime font
    // store outside the bundle — a product decision, not a build tweak.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
        },
      },
    },
  },
});
