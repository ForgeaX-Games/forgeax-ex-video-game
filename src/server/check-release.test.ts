import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { validateRelease } from '../../scripts/check-release.mjs'

const fixtureBase = mkdtempSync(resolve(import.meta.dirname, '.check-release-'))
const toolId = 'game-video:get-graph'
const videoGenerationToolIds = [
  'game-video:generate-video',
  'game-video:generate-node-video',
] as const
const videoGenerationRequirement = [{ id: 'media.video.generate', version: 1 }]
const reviewedExtensionHostSpec = '0.3.0'
const oldToolId = ['gv', 'id:get-graph'].join('')
const oldStorageKey = ['game', 'video:graph:view'].join('')
const oldDottedStorageKey = ['gv', 'id.nodePanel.previewW'].join('')
const oldBrandName = ['reel', 'studio'].join('-')
interface FixtureOptions {
  backendKeys?: string[]
  malformedManifest?: boolean
  malformedPackage?: boolean
  manifestVersion?: string
  manifestBackend?: string
  missingBackend?: boolean
  missingNamedHost?: boolean
  missingReturns?: boolean
  missingStandalone?: boolean
  namedToolKeys?: string[]
  packageName?: string
  packageExports?: unknown
  packageFiles?: string[]
  platformVersion?: string
  extensionHostVersion?: string
  localPackagePath?: string
  lockSource?: string
  oldIdentityDistSource?: string
  oldIdentityFiles?: Record<string, string>
  oldIdentitySource?: string
  forbiddenPublishedText?: string
  frontendSource?: string
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function createFixture(name: string, options: FixtureOptions = {}): string {
  const root = resolve(fixtureBase, name)
  mkdirSync(resolve(root, 'dist/assets'), { recursive: true })
  mkdirSync(resolve(root, 'dist/player'), { recursive: true })
  mkdirSync(resolve(root, 'dist/server'), { recursive: true })
  mkdirSync(resolve(root, 'schemas'), { recursive: true })
  mkdirSync(resolve(root, 'docs'), { recursive: true })
  mkdirSync(resolve(root, 'src/editor/__tests__'), { recursive: true })
  if (options.malformedPackage) {
    writeFileSync(resolve(root, 'package.json'), '{ invalid package JSON\n')
  } else {
    writeJson(resolve(root, 'package.json'), {
      name: options.packageName ?? '@forgeax-extension/game-video',
      version: '0.2.4',
      repository: {
        type: 'git',
        url: 'git+https://github.com/ForgeaX-Games/forgeax-ex-video-game.git',
      },
      publishConfig: { access: 'public' },
      peerDependencies: {
        '@forgeax/extension-platform': options.platformVersion ?? '0.0.3',
        '@forgeax/extension-host': options.extensionHostVersion ?? '^0.3.0',
      },
      devDependencies: {
        '@forgeax/extension-platform': options.platformVersion ?? '0.0.3',
        '@forgeax/extension-host': options.extensionHostVersion ?? reviewedExtensionHostSpec,
      },
      exports: options.packageExports ?? {
        '.': './dist/index.js',
        './host': './dist/server/host.js',
        './standalone': './dist/player/index.html',
      },
      files: options.packageFiles ?? [
        'dist',
        'forgeax-extension.json',
        'schemas',
        'README.md',
        'SKILL.md',
        '!dist/**/*.mp4',
        'dist/assets/placeholder-video.mp4',
      ],
      ...(options.localPackagePath
        ? { overrides: { '@forgeax/extension-host': options.localPackagePath } }
        : {}),
    })
  }
  if (options.malformedManifest) {
    writeFileSync(resolve(root, 'forgeax-extension.json'), '{ invalid manifest JSON\n')
  } else {
    writeJson(resolve(root, 'forgeax-extension.json'), {
      id: '@forgeax-extension/game-video',
      version: options.manifestVersion ?? '0.2.4',
      entry: {
        frontend: './dist/index.html',
        backend: options.manifestBackend ?? './dist/server/host.js',
      },
      contributes: {
        skills: [
          {
            id: 'game-video:author-guide',
            entry: './SKILL.md',
          },
        ],
        tools: [
          {
            id: toolId,
            args: './schemas/get-graph.args.json',
            returns: './schemas/get-graph.returns.json',
          },
          ...videoGenerationToolIds.map((id) => ({
            id,
            args: './schemas/get-graph.args.json',
            returns: './schemas/get-graph.returns.json',
            requiresCapabilities: videoGenerationRequirement,
          })),
        ],
      },
    })
  }
  writeFileSync(resolve(root, 'dist/index.html'), '<!doctype html>\n')
  writeFileSync(resolve(root, 'dist/index.js'), options.frontendSource ?? 'export {}\n')
  writeFileSync(resolve(root, 'dist/assets/placeholder-video.mp4'), 'placeholder')
  if (!options.missingStandalone) {
    writeFileSync(resolve(root, 'dist/player/index.html'), '<!doctype html>\n')
  }
  writeFileSync(resolve(root, 'SKILL.md'), '# Author guide\n')
  writeFileSync(resolve(root, 'bun.lock'), options.lockSource ?? 'lock\n')
  writeJson(resolve(root, 'schemas/get-graph.args.json'), { type: 'object' })
  if (!options.missingReturns) {
    writeJson(resolve(root, 'schemas/get-graph.returns.json'), { type: 'object' })
  }
  if (!options.missingBackend) {
    const keys = options.backendKeys ?? [toolId, ...videoGenerationToolIds]
    const namedKeys = options.namedToolKeys ?? keys
    writeFileSync(
      resolve(root, 'dist/server/host.js'),
      `${options.missingNamedHost ? '' : 'export const host = {}\n'}export const tools = {${namedKeys.map((key) => `${JSON.stringify(key)}: async () => ({})`).join(',')}}\nexport default {${keys.map((key) => `${JSON.stringify(key)}: async () => ({})`).join(',')}}\n`,
    )
  }

  // Historical prose and the one-time migration are allowed to name legacy IDs.
  writeFileSync(resolve(root, 'docs/history.md'), `${oldToolId}\n`)
  writeFileSync(
    resolve(root, 'src/editor/bootMigrateLegacyKeys.ts'),
    `${JSON.stringify(oldStorageKey)}\n`,
  )
  writeFileSync(
    resolve(root, 'src/editor/__tests__/bootMigrateLegacyKeys.test.ts'),
    `${JSON.stringify(oldToolId)}\n`,
  )
  writeFileSync(
    resolve(root, 'dist/assets/migration.js'),
    `const prefixes = [${JSON.stringify(oldBrandName)}, ${JSON.stringify(['game', 'video'].join(''))}, ${JSON.stringify(['gv', 'id'].join(''))}]\n`,
  )
  if (options.oldIdentityDistSource) {
    writeFileSync(resolve(root, 'dist/assets/stale.js'), options.oldIdentityDistSource)
  }
  if (options.oldIdentitySource) {
    writeFileSync(resolve(root, 'src/active.ts'), options.oldIdentitySource)
  }
  if (options.forbiddenPublishedText) {
    writeFileSync(resolve(root, 'dist/server/provider-wiring.js'), options.forbiddenPublishedText)
  }
  for (const [path, source] of Object.entries(options.oldIdentityFiles ?? {})) {
    mkdirSync(resolve(root, dirname(path)), { recursive: true })
    writeFileSync(resolve(root, path), source)
  }

  return root
}

afterAll(() => {
  rmSync(fixtureBase, { recursive: true, force: true })
})

describe('validateRelease', () => {
  it('accepts a complete self-contained release package', async () => {
    const fixtureRoot = createFixture('valid')

    expect(await validateRelease(fixtureRoot)).toEqual([])
  })

  it('requires host video capability annotations and rejects provider wiring in published text', async () => {
    const missingCapabilityRoot = createFixture('missing-video-capability')
    const manifestPath = resolve(missingCapabilityRoot, 'forgeax-extension.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const generateVideo = manifest.contributes.tools.find(
      (tool: { id: string }) => tool.id === videoGenerationToolIds[0],
    )
    generateVideo.requiresCapabilities = []
    writeJson(manifestPath, manifest)

    expect(await validateRelease(missingCapabilityRoot)).toContainEqual(
      expect.stringContaining('requiresCapabilities'),
    )

    // Product Kino routes are forbidden by the production-source release
    // contract above; provider ids and legacy upload proxies remain forbidden
    // in published artifacts here.
    for (const forbiddenPublishedText of [
      'arrival-kino',
      '__video-upload-proxy',
    ]) {
      const providerWiringRoot = createFixture(`provider-wiring-${forbiddenPublishedText.replaceAll('/', '-')}`, {
        forbiddenPublishedText,
      })
      expect(await validateRelease(providerWiringRoot)).toContainEqual(
        expect.stringContaining('forbidden provider integration text'),
      )
    }
  })

  it('requires both generation tool IDs even when manifest and compiled handlers agree', async () => {
    const fixtureRoot = createFixture('missing-generation-tool')
    const manifestPath = resolve(fixtureRoot, 'forgeax-extension.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const remainingToolIds = [toolId, videoGenerationToolIds[0]]
    manifest.contributes.tools = manifest.contributes.tools.filter(
      (tool: { id: string }) => remainingToolIds.includes(tool.id),
    )
    writeJson(manifestPath, manifest)
    writeFileSync(
      resolve(fixtureRoot, 'dist/server/host.js'),
      `export const host = {}\nexport const tools = {${remainingToolIds.map((id) => `${JSON.stringify(id)}: async () => ({})`).join(',')}}\n`,
    )

    expect(await validateRelease(fixtureRoot)).toContainEqual(
      expect.stringContaining(videoGenerationToolIds[1]),
    )
  })

  it('requires release packages to exclude dist MP4s', async () => {
    const fixtureRoot = createFixture('missing-mp4-exclude-rule', {
      packageFiles: ['dist', 'forgeax-extension.json', 'schemas', 'README.md', 'SKILL.md'],
    })

    expect(await validateRelease(fixtureRoot)).toContainEqual(
      expect.stringContaining('package files must exclude all dist MP4s'),
    )
  })

  it('rejects raw SVG payloads in the compiled frontend bundle', async () => {
    const fixtureRoot = createFixture('raw-svg-data-uri', {
      frontendSource: `export const icon = ${JSON.stringify('data:image/svg+xml,<svg fill="#fff"></svg>')}\n`,
    })

    expect(await validateRelease(fixtureRoot)).toContainEqual(
      expect.stringContaining('percent-encode SVG data URI payloads'),
    )
  })

  it('accumulates missing release entries without importing a missing backend', async () => {
    const missingBackendRoot = createFixture('missing-backend', {
      missingBackend: true,
      missingReturns: true,
    })

    const errors = await validateRelease(missingBackendRoot)
    expect(errors).toContainEqual(expect.stringContaining('entry.backend'))
    expect(errors).toContainEqual(expect.stringContaining('returns'))
  })

  it('still validates manifest paths when package JSON is malformed', async () => {
    const malformedPackageRoot = createFixture('malformed-package', {
      malformedPackage: true,
      missingBackend: true,
      missingReturns: true,
    })

    const errors = await validateRelease(malformedPackageRoot)
    expect(errors).toContainEqual(expect.stringContaining('package.json is not readable JSON'))
    expect(errors).toContainEqual(expect.stringContaining('entry.backend'))
    expect(errors).toContainEqual(expect.stringContaining('returns'))
  })

  it('still validates package identity and dependencies when manifest JSON is malformed', async () => {
    const malformedManifestRoot = createFixture('malformed-manifest', {
      malformedManifest: true,
      packageName: '@forgeax-extension/game-video-invalid',
      platformVersion: '0.0.1',
      extensionHostVersion: '0.1.1',
    })

    const errors = await validateRelease(malformedManifestRoot)
    expect(errors).toContainEqual(expect.stringContaining('forgeax-extension.json is not readable JSON'))
    expect(errors).toContainEqual(expect.stringContaining('package name'))
    expect(errors).toContainEqual(expect.stringContaining('peerDependencies'))
    expect(errors).toContainEqual(expect.stringContaining('devDependencies'))
    expect(errors).toContainEqual(expect.stringContaining('@forgeax/extension-host'))
  })

  it('requires the root and host package exports', async () => {
    const fixtureRoot = createFixture('missing-host-export', {
      packageExports: { '.': './dist/index.js' },
    })

    expect(await validateRelease(fixtureRoot)).toContainEqual(
      expect.stringContaining('exports["./host"]'),
    )
  })

  it('requires the standalone package export target to exist', async () => {
    const fixtureRoot = createFixture('missing-standalone-export-target', {
      missingStandalone: true,
    })

    expect(await validateRelease(fixtureRoot)).toContainEqual(
      expect.stringContaining('exports["./standalone"] does not exist'),
    )
  })

  it('requires the host backend manifest entry', async () => {
    const fixtureRoot = createFixture('wrong-backend-entry', {
      manifestBackend: './dist/server/tool-handlers.js',
    })

    expect(await validateRelease(fixtureRoot)).toContainEqual(
      expect.stringContaining('entry.backend must be exactly ./dist/server/host.js'),
    )
  })

  it('reports the package-derived tag when manifest version differs', async () => {
    const badVersionRoot = createFixture('bad-version', {
      manifestVersion: '0.2.3',
    })

    expect(await validateRelease(badVersionRoot)).toContainEqual(
      expect.stringContaining('v0.2.4'),
    )
  })

  it('rejects compiled handlers that differ from manifest tool order', async () => {
    const badToolRoot = createFixture('bad-tools', {
      backendKeys: ['game-video:save-graph'],
    })

    expect(await validateRelease(badToolRoot)).toContainEqual(
      expect.stringContaining('named tools keys'),
    )
  })

  it('requires the compiled backend to export named host and tools', async () => {
    const fixtureRoot = createFixture('missing-named-host', {
      missingNamedHost: true,
    })

    expect(await validateRelease(fixtureRoot)).toContainEqual(
      expect.stringContaining('named host'),
    )
  })

  it('checks named compiled tools rather than the default export', async () => {
    const fixtureRoot = createFixture('bad-named-tools', {
      namedToolKeys: ['game-video:save-graph'],
    })

    expect(await validateRelease(fixtureRoot)).toContainEqual(
      expect.stringContaining('named tools keys'),
    )
  })

  it.each([
    ['package.json', { localPackagePath: 'file:/Users/you/extension-host.tgz' }],
    ['bun.lock', { lockSource: '"file:///Users/you/extension-host.tgz"\n' }],
  ])('rejects local absolute paths in %s', async (_label, options) => {
    const fixtureRoot = createFixture(`local-path-${_label}`, options)

    expect(await validateRelease(fixtureRoot)).toContainEqual(
      expect.stringContaining('local absolute path'),
    )
  })

  it('rejects legacy active identities outside historical and migration files', async () => {
    const oldIdentityRoot = createFixture('old-identity', {
      oldIdentitySource: `export const tool = ${JSON.stringify(oldToolId)}\n`,
    })

    expect(await validateRelease(oldIdentityRoot)).toContainEqual(
      expect.stringContaining('old active identity'),
    )
  })

  it('rejects legacy active identities in tracked dist files', async () => {
    const oldIdentityRoot = createFixture('old-dist-identity', {
      oldIdentityDistSource: `export const tool = ${JSON.stringify(oldToolId)}\n`,
    })

    expect(await validateRelease(oldIdentityRoot)).toContainEqual(
      expect.stringContaining('dist/assets/stale.js'),
    )
  })

  it.each([
    `${['game', 'video'].join('')}.html`,
    `${['wb', 'video', 'game'].join('-')}.html`,
    `${['reel', 'studio'].join('-')}.html`,
    `${['gv', 'id'].join('')}.html`,
    `${['@forgeax', 'game-video'].join('/')}/index.html`,
  ])('rejects legacy active identity in relative path %s', async (legacyPath) => {
    const activePath = `src/player/${legacyPath}`
    const oldIdentityRoot = createFixture(`old-path-${legacyPath.replaceAll('/', '-')}`, {
      oldIdentityFiles: {
        [activePath]: '<!doctype html>\n',
      },
    })

    expect(await validateRelease(oldIdentityRoot)).toContainEqual(
      expect.stringContaining(activePath),
    )
  })

  it('checks legacy names on binary, unknown, extensionless, directory, and symlink entries', async () => {
    const fixtureRoot = createFixture('all-entry-kinds')
    const compactOldName = ['game', 'video'].join('')
    const paths = [
      `src/runtime/${compactOldName}.bin`,
      `src/runtime/${compactOldName}.unknown-extension`,
      `src/runtime/${compactOldName}`,
      `src/runtime/${compactOldName}-directory`,
      `src/runtime/${compactOldName}-symlink`,
    ]
    mkdirSync(resolve(fixtureRoot, 'src/runtime'), { recursive: true })
    writeFileSync(resolve(fixtureRoot, paths[0]!), Buffer.from([0, 255, 1, 254]))
    writeFileSync(resolve(fixtureRoot, paths[1]!), 'not a known text extension\n')
    writeFileSync(resolve(fixtureRoot, paths[2]!), 'extensionless\n')
    mkdirSync(resolve(fixtureRoot, paths[3]!))
    symlinkSync(resolve(fixtureRoot, '..', 'outside-package'), resolve(fixtureRoot, paths[4]!))

    const errors = await validateRelease(fixtureRoot)
    for (const path of paths) {
      expect(errors).toContainEqual(expect.stringContaining(path))
    }
  })

  it.each([
    [[`Game`, `Video.BIN`].join('')],
    [[`WB`, `VIDEO`, `GAME.bin`].join('_')],
    [[`ReEl`, `StUdIo`].join('_')],
    [[`G`, `VID-link`].join('_')],
  ])('normalizes case and separator variants in active path %s', async (legacyName) => {
    const activePath = `src/runtime/${legacyName}`
    const oldIdentityRoot = createFixture(`normalized-${legacyName}`, {
      oldIdentityFiles: { [activePath]: 'active\n' },
    })

    expect(await validateRelease(oldIdentityRoot)).toContainEqual(
      expect.stringContaining(activePath),
    )
  })

  it('allows legacy path names only below the root historical docs directory', async () => {
    const oldName = ['game', 'video'].join('')
    const historicalRoot = createFixture('root-docs-path-exemption', {
      oldIdentityFiles: {
        [`docs/${oldName}.bin`]: 'historical\n',
      },
    })
    const nestedDocsRoot = createFixture('nested-docs-not-exempt', {
      oldIdentityFiles: {
        [`src/runtime/docs/${oldName}.bin`]: 'active\n',
      },
    })

    expect(await validateRelease(historicalRoot)).toEqual([])
    expect(await validateRelease(nestedDocsRoot)).toContainEqual(
      expect.stringContaining(`src/runtime/docs/${oldName}.bin`),
    )
  })

  it('accepts the unified identity in active relative path names', async () => {
    const unifiedIdentityRoot = createFixture('unified-path-identity', {
      oldIdentityFiles: {
        'src/player/index.html': '<!doctype html>\n',
      },
    })

    expect(await validateRelease(unifiedIdentityRoot)).toEqual([])
  })

  it('scans a unified symlink name without following its outside target', async () => {
    const fixtureRoot = createFixture('unified-outside-symlink')
    symlinkSync(
      resolve(fixtureRoot, '..', 'outside-package'),
      resolve(fixtureRoot, 'src/game-video-link'),
    )

    expect(await validateRelease(fixtureRoot)).toEqual([])
  })

  it('rejects a dotted legacy browser-key namespace', async () => {
    const oldIdentityRoot = createFixture('old-dotted-gvid', {
      oldIdentitySource: `export const key = ${JSON.stringify(oldDottedStorageKey)}\n`,
    })

    expect(await validateRelease(oldIdentityRoot)).toContainEqual(
      expect.stringContaining('src/active.ts'),
    )
  })

  it.each([
    ['bun.lock', `"name": ${JSON.stringify(oldBrandName)}\n`],
    ['src/server/engine/llm/skills/README.md', `# ${oldBrandName} Prompt Skills\n`],
  ])('rejects legacy package branding in %s', async (path, source) => {
    const oldIdentityRoot = createFixture(`old-brand-${path.replaceAll('/', '-')}`, {
      oldIdentityFiles: { [path]: source },
    })

    expect(await validateRelease(oldIdentityRoot)).toContainEqual(
      expect.stringContaining(path),
    )
  })

  it('allows legacy names only in the exact migration and historical-doc exemptions', async () => {
    const migrationRoot = createFixture('migration-exemptions')

    expect(await validateRelease(migrationRoot)).toEqual([])
  })
})
