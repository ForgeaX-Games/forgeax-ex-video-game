/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import type { ConfigEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { createViteExtensionPlugin } from '@forgeax/extension-host/vite'
import { createDevExtensionHost } from './src/server/dev-host'
import { resolveViteDevPort } from './scripts/vite-dev-port'

export { resolveViteDevPort } from './scripts/vite-dev-port'

export default defineConfig(({ command }: ConfigEnv) => ({
  root: resolve(__dirname, 'src/editor'),
  base: process.env.VITE_PLUGIN_BASE
    ?? (process.env.GAME_VIDEO_PLUGIN_BUILD === '1' ? '/extensions/game-video/' : './'),
  plugins: [
    react(),
    // Vitest loads this config with command=serve; skip the local games-root
    // mkdir (can resolve outside the checkout, e.g. /Users/you/games).
    ...(command === 'serve' && !process.env.VITEST
      ? [createViteExtensionPlugin(createDevExtensionHost())]
      : []),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
  },
  server: {
    host: true,
    port: resolveViteDevPort(),
    strictPort: true,
    allowedHosts: true as const,
    // Asset CRUD still uses extension-owned `/api/*` routes in standalone dev.
    // Video generation itself goes through the Extension Host handshake/tool endpoint.
    proxy: {
      '/api': process.env.FORGEAX_SERVER_URL
        ?? `http://localhost:${process.env.FORGEAX_SERVER_PORT ?? process.env.PORT_SERVER ?? 18900}`,
    },
  },
  test: {
    root: __dirname,
    environment: 'happy-dom',
    globals: true,
    // Happy DOM/React suites are memory- and CPU-heavy; unrestricted workers
    // can starve real-time assertions and turn stable UI tests into timeouts.
    maxWorkers: 4,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}', 'src/server/**/*.test.ts'],
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: process.env.RS_NO_SOURCEMAP === '1' ? false : true,
    rollupOptions: {
      output: {
        // The library build already places this font at dist/HYShangWei.woff2.
        // Emit the editor URL to that shared file instead of packaging a second
        // 6.4 MB copy under dist/assets (the standalone build keeps its own copy).
        assetFileNames(assetInfo) {
          return assetInfo.name?.endsWith('.woff2')
            ? 'HYShangWei.woff2'
            : 'assets/[name]-[hash][extname]'
        },
      },
    },
  },
}))
