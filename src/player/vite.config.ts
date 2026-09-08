import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { resolveViteDevPort } from '../../scripts/vite-dev-port'

const configDir = dirname(fileURLToPath(import.meta.url))
const extensionRoot = resolve(configDir, '..', '..')
const playerRoot = configDir

export default {
  root: playerRoot,
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(extensionRoot, 'src') },
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
  },
  server: {
    host: true,
    port: resolveViteDevPort(),
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: resolveViteDevPort(),
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    outDir: resolve(extensionRoot, 'dist/player'),
    emptyOutDir: true,
    sourcemap: process.env.RS_NO_SOURCEMAP === '1' ? false : true,
    rollupOptions: {
      input: {
        index: resolve(playerRoot, 'index.html'),
      },
    },
  },
}
