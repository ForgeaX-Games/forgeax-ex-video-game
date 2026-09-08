import { cp, readFile } from 'node:fs/promises'
import type { Plugin } from 'esbuild'
import { defineConfig } from 'tsup'

const encodedSvgDataUrlPlugin: Plugin = {
  name: 'encoded-svg-data-url',
  setup(build) {
    build.onLoad({ filter: /\.svg(?:\?url)?$/ }, async ({ path }) => {
      const source = await readFile(path.replace(/\?url$/, ''), 'utf8')
      const dataUrl = `data:image/svg+xml,${encodeURIComponent(source)}`
      return {
        contents: `export default ${JSON.stringify(dataUrl)}`,
        loader: 'js',
      }
    })
  },
}

export default defineConfig({
  entry: {
    index: 'src/editor/mount.tsx',
    'server/host': 'src/server/host.ts',
  },
  outDir: 'dist',
  dts: true,
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  bundle: true,
  esbuildPlugins: [encodedSvgDataUrlPlugin],
  esbuildOptions(options) {
    // `mount()` is consumed from a pre-built npm package. Keep every asset it
    // imports self-contained so a host bundler never has to resolve a relative
    // URL next to an emitted JS chunk (Arrival mounts it in-process).
    options.loader = {
      ...options.loader,
      '.png': 'dataurl',
    }
  },
  splitting: false,
  sourcemap: true,
  clean: false,
  external: ['@forgeax/extension-platform'],
  // Component source validation must run from unpacked extension directories
  // that do not have their own node_modules tree.
  noExternal: [
    'acorn',
    'eslint-scope',
    // The Host backend is also loaded from an unpacked directory in local
    // development. Bundle the peer so that directory extensions do not need
    // a private node_modules tree just to resolve the runtime host.
    '@forgeax/extension-host',
  ],
  onSuccess: async () => {
    await cp('src/server/engine/llm/skills', 'dist/skills', { recursive: true })
    await cp(
      'src/runtime/react/assets/placeholder-video.mp4',
      'dist/assets/placeholder-video.mp4',
    )
    await cp(
      'src/runtime/react/component-host/components/HYShangWei.woff2',
      'dist/HYShangWei.woff2',
    )
  },
})
