import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/** Isolated config so SDK unit tests do not load the Extension dev-host Vite plugin. */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, '..') },
  },
  test: {
    environment: 'node',
    include: ['src/player/**/__tests__/**/*.test.{ts,tsx}'],
  },
})
