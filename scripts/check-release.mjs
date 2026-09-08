import {
  readdir,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
const PACKAGE_NAME = '@forgeax-extension/game-video'
const REPOSITORY_URL = 'git+https://github.com/ForgeaX-Games/forgeax-ex-video-game.git'
const FORBIDDEN_DEPENDENCY_SPEC = /^(?:file:|link:|workspace:|git(?:\+|:))/u
const PLATFORM_PACKAGE = '@forgeax/extension-platform'
const PLATFORM_VERSION = '0.0.3'
const EXTENSION_HOST_PACKAGE = '@forgeax/extension-host'
const EXTENSION_HOST_PEER_VERSION = '^0.3.0'
const EXTENSION_HOST_DEV_SPEC = '0.3.0'
const HOST_BACKEND_ENTRY = './dist/server/host.js'
const PLACEHOLDER_VIDEO_PATH = 'dist/assets/placeholder-video.mp4'
const MP4_EXCLUDE_RULE = '!dist/**/*.mp4'
const VIDEO_GENERATION_TOOL_IDS = [
  'game-video:generate-video',
  'game-video:generate-node-video',
]
const REQUIRED_VIDEO_CAPABILITY = { id: 'media.video.generate', version: 1 }
const RAW_SVG_DATA_URI = 'data:image/svg+xml,<svg'
const FORBIDDEN_PROVIDER_INTEGRATION_TEXT = [
  'arrival-kino',
  '__video-upload-proxy',
]
const PUBLISHED_TEXT_PATHS = [
  'dist',
  'forgeax-extension.json',
  'package.json',
  'schemas',
  'README.md',
  'SKILL.md',
]
const REQUIRED_PACKAGE_EXPORTS = {
  '.': './dist/index.js',
  './host': HOST_BACKEND_ENTRY,
  './standalone': './dist/player/index.html',
}
const TEXT_EXTENSIONS = new Set([
  '.css',
  '.env',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.lock',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])
const TEXT_FILENAMES = new Set([
  '.env.example',
  '.gitignore',
  'AGENTS.md',
  'README.md',
  'SKILL.md',
])
const SCAN_EXCLUDED_DIRS = new Set([
  '.git',
  '.worktrees',
  'node_modules',
])
const SCAN_EXCLUDED_FILES = new Set([
  'src/editor/bootMigrateLegacyKeys.ts',
  'src/editor/__tests__/bootMigrateLegacyKeys.test.ts',
])
const compactLegacyName = ['game', 'video'].join('')
const compactLegacyReelName = ['reel', 'studio'].join('-')
const oldToolNamespaces = [['gv', 'id'].join(''), ['g', 'en'].join('')]
const oldEnvironmentNames = [
  ['PORT', 'REEL', 'STUDIO'].join('_'),
  ['PORT', ['GAME', 'VIDEO'].join(''), 'STUDIO'].join('_'),
  ['WB', ['GAME', 'VIDEO'].join(''), 'PLUGIN', 'BUILD'].join('_'),
]
const OLD_ACTIVE_IDENTITIES = [
  // Former package / manifest scope before @forgeax-extension alignment.
  // Joined so this file itself does not match the scanner.
  new RegExp(['@forgeax/', 'wb-game-', 'video'].join('')),
  new RegExp(`\\b(?:${oldToolNamespaces.join('|')})(?::[a-z]|\\.)`, 'i'),
  new RegExp(`\\b${compactLegacyReelName}\\b`, 'i'),
  new RegExp(`\\b${compactLegacyName}(?:[:.\\-\\]]|\\b)`, 'i'),
  new RegExp(`\\b(?:${oldEnvironmentNames.join('|')})\\b`),
  new RegExp(`emit:${compactLegacyName}`),
  new RegExp(`/${compactLegacyName}\\b`),
]
const OLD_ACTIVE_PATH_ROOTS = [
  compactLegacyName,
  ['wb', 'video', 'game'].join('-'),
  compactLegacyReelName,
  oldToolNamespaces[0],
  ['g', 'vid'].join('-'),
]
const GENERATED_MIGRATION_PREFIX_LIST = new RegExp(
  `\\[\\s*(["'])${compactLegacyReelName}\\1\\s*,\\s*(["'])${compactLegacyName}\\2\\s*,\\s*(["'])${oldToolNamespaces[0]}\\3\\s*\\]`,
  'g',
)

function isWithinRoot(root, candidate) {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === '' || (
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`)
  )
}

async function readJson(path, label, errors) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    errors.push(`${label} is not readable JSON: ${error.message}`)
    return null
  }
}

async function checkPackagePath(root, label, entry, errors) {
  if (typeof entry !== 'string' || entry.length === 0) {
    errors.push(`${label} must be a non-empty package-relative path`)
    return null
  }

  const candidate = resolve(root, entry)
  if (!isWithinRoot(root, candidate)) {
    errors.push(`${label} resolves outside the package root: ${entry}`)
    return null
  }

  try {
    const info = await stat(candidate)
    if (!info.isFile()) {
      errors.push(`${label} must resolve to a file within the package root: ${entry}`)
      return null
    }
    const realCandidate = await realpath(candidate)
    const realRoot = await realpath(root)
    if (!isWithinRoot(realRoot, realCandidate)) {
      errors.push(`${label} resolves outside the package root through a symlink: ${entry}`)
      return null
    }
    return candidate
  } catch {
    errors.push(`${label} does not exist within the package root: ${entry}`)
    return null
  }
}

function isTextFile(path) {
  const name = path.split('/').at(-1)
  return TEXT_FILENAMES.has(name) || TEXT_EXTENSIONS.has(extname(path))
}

function identityScanSource(packagePath, source) {
  if (!packagePath.startsWith('dist/')) return source
  return source.replace(
    GENERATED_MIGRATION_PREFIX_LIST,
    '["generated-legacy-migration-prefixes"]',
  )
}

function normalizePathComponent(component) {
  return component.toLowerCase().replaceAll(/[_-]+/g, '-')
}

function oldIdentityPathMatch(packagePath) {
  const components = packagePath.split('/').map(normalizePathComponent)
  for (const [index, component] of components.entries()) {
    for (const oldRoot of OLD_ACTIVE_PATH_ROOTS) {
      if (
        component === oldRoot ||
        component.startsWith(`${oldRoot}.`) ||
        component.startsWith(`${oldRoot}-`)
      ) {
        return components.slice(0, index + 1).join('/')
      }
    }

    if (
      component === '@forgeax' &&
      components[index + 1] === 'game-video'
    ) {
      return components.slice(0, index + 2).join('/')
    }
  }
  return null
}

async function findOldActiveIdentities(root, errors) {
  const pending = ['']
  while (pending.length > 0) {
    const directory = pending.pop()
    const entries = await readdir(resolve(root, directory), { withFileTypes: true })
    for (const entry of entries) {
      const packagePath = directory ? `${directory}/${entry.name}` : entry.name
      const isRootHistoricalDocs = (
        directory === '' &&
        entry.isDirectory() &&
        entry.name === 'docs'
      )
      const isExcludedDirectory = (
        entry.isDirectory() &&
        (isRootHistoricalDocs || SCAN_EXCLUDED_DIRS.has(entry.name))
      )

      if (isExcludedDirectory) continue

      const oldPathMatch = oldIdentityPathMatch(packagePath)
      if (oldPathMatch) {
        errors.push(
          `old active identity ${JSON.stringify(oldPathMatch)} in relative path ${packagePath}`,
        )
      }

      if (entry.isDirectory()) {
        pending.push(packagePath)
        continue
      }
      if (
        !entry.isFile() ||
        SCAN_EXCLUDED_FILES.has(packagePath) ||
        !isTextFile(packagePath)
      ) {
        continue
      }

      const source = identityScanSource(
        packagePath,
        await readFile(resolve(root, packagePath), 'utf8'),
      )
      for (const pattern of OLD_ACTIVE_IDENTITIES) {
        const match = pattern.exec(source)
        if (!match) continue
        const line = source.slice(0, match.index).split('\n').length
        errors.push(
          `old active identity ${JSON.stringify(match[0])} in ${packagePath}:${line}`,
        )
        break
      }
    }
  }
}

function hasLocalAbsolutePath(value) {
  if (typeof value === 'string') {
    return (
      value.startsWith('/')
      || /^file:\/(?!\.?\/vendor\/)/.test(value)
      || /\/(?:Users|private|var\/folders)\//.test(value)
      || /^[A-Za-z]:[\\/]/.test(value)
    )
  }
  if (Array.isArray(value)) return value.some(hasLocalAbsolutePath)
  if (value && typeof value === 'object') {
    return Object.values(value).some(hasLocalAbsolutePath)
  }
  return false
}

async function validateNoLocalAbsolutePaths(packageRoot, pkg, errors) {
  if (hasLocalAbsolutePath(pkg)) {
    errors.push('package.json contains a local absolute path')
  }

  try {
    const lockSource = await readFile(resolve(packageRoot, 'bun.lock'), 'utf8')
    if (hasLocalAbsolutePath(lockSource)) {
      errors.push('bun.lock contains a local absolute path')
    }
  } catch {
    errors.push('bun.lock is not readable')
  }
}

async function validatePackage(packageRoot, pkg, errors) {
  if (pkg.name !== PACKAGE_NAME) {
    errors.push(`package name must be ${PACKAGE_NAME}; received ${JSON.stringify(pkg.name)}`)
  }
  if (pkg.repository?.url !== REPOSITORY_URL) {
    errors.push(`repository.url must be ${REPOSITORY_URL}; received ${JSON.stringify(pkg.repository?.url)}`)
  }
  if (pkg.publishConfig?.access !== 'public') {
    errors.push('publishConfig.access must be public')
  }
  for (const dependencyKind of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(pkg[dependencyKind] ?? {})) {
      if (typeof spec !== 'string' || FORBIDDEN_DEPENDENCY_SPEC.test(spec)) {
        errors.push(`${dependencyKind}.${name} must use a registry version`)
      }
    }
  }

  for (const dependencyKind of ['peerDependencies', 'devDependencies']) {
    const actual = pkg[dependencyKind]?.[PLATFORM_PACKAGE]
    if (actual !== PLATFORM_VERSION) {
      errors.push(
        `${dependencyKind}.${PLATFORM_PACKAGE} must be exactly ${PLATFORM_VERSION}; received ${JSON.stringify(actual)}`,
      )
    }
  }
  if (pkg.peerDependencies?.[EXTENSION_HOST_PACKAGE] !== EXTENSION_HOST_PEER_VERSION) {
    errors.push(`peerDependencies.${EXTENSION_HOST_PACKAGE} must be exactly ${EXTENSION_HOST_PEER_VERSION}; received ${JSON.stringify(pkg.peerDependencies?.[EXTENSION_HOST_PACKAGE])}`)
  }
  if (pkg.devDependencies?.[EXTENSION_HOST_PACKAGE] !== EXTENSION_HOST_DEV_SPEC) {
    errors.push(`devDependencies.${EXTENSION_HOST_PACKAGE} must be exactly ${EXTENSION_HOST_DEV_SPEC}; received ${JSON.stringify(pkg.devDependencies?.[EXTENSION_HOST_PACKAGE])}`)
  }

  for (const [exportName, expectedPath] of Object.entries(REQUIRED_PACKAGE_EXPORTS)) {
    const actual = pkg.exports?.[exportName]
    if (actual !== expectedPath) {
      errors.push(
        `exports[${JSON.stringify(exportName)}] must be exactly ${expectedPath}; received ${JSON.stringify(actual)}`,
      )
    }
    await checkPackagePath(
      packageRoot,
      `exports[${JSON.stringify(exportName)}]`,
      actual,
      errors,
    )
  }

  if (!Array.isArray(pkg.files) || !pkg.files.includes('dist') || pkg.files.includes('vendor')) {
    errors.push('package files must include dist and exclude vendor')
  }
  if (
    !Array.isArray(pkg.files)
    || !pkg.files.includes(MP4_EXCLUDE_RULE)
    || !pkg.files.includes(PLACEHOLDER_VIDEO_PATH)
  ) {
    errors.push(`package files must exclude all dist MP4s except ${PLACEHOLDER_VIDEO_PATH}`)
  }

  try {
    const placeholder = await stat(resolve(packageRoot, PLACEHOLDER_VIDEO_PATH))
    if (!placeholder.isFile()) {
      errors.push(`${PLACEHOLDER_VIDEO_PATH} must be a file`)
    }
  } catch {
    errors.push(`${PLACEHOLDER_VIDEO_PATH} is missing from the release output`)
  }
}

async function validateManifest(packageRoot, manifest, errors) {
  if (manifest.id !== PACKAGE_NAME) {
    errors.push(
      `manifest ID must be ${PACKAGE_NAME}; received ${JSON.stringify(manifest.id)}`,
    )
  }

  if (manifest.entry?.backend !== HOST_BACKEND_ENTRY) {
    errors.push(`entry.backend must be exactly ${HOST_BACKEND_ENTRY}; received ${JSON.stringify(manifest.entry?.backend)}`)
  }

  const backendPath = await checkPackagePath(
    packageRoot,
    'entry.backend',
    manifest.entry?.backend,
    errors,
  )
  await checkPackagePath(
    packageRoot,
    'entry.frontend',
    manifest.entry?.frontend,
    errors,
  )

  const skills = Array.isArray(manifest.contributes?.skills)
    ? manifest.contributes.skills
    : []
  for (const [index, skill] of skills.entries()) {
    await checkPackagePath(
      packageRoot,
      `contributes.skills[${index}].entry`,
      skill?.entry,
      errors,
    )
  }

  const tools = Array.isArray(manifest.contributes?.tools)
    ? manifest.contributes.tools
    : []
  for (const [index, tool] of tools.entries()) {
    await checkPackagePath(
      packageRoot,
      `contributes.tools[${index}].args`,
      tool?.args,
      errors,
    )
    await checkPackagePath(
      packageRoot,
      `contributes.tools[${index}].returns`,
      tool?.returns,
      errors,
    )
  }

  for (const requiredToolId of VIDEO_GENERATION_TOOL_IDS) {
    const index = tools.findIndex((tool) => tool?.id === requiredToolId)
    if (index === -1) {
      errors.push(`contributes.tools must include required video generation tool ${JSON.stringify(requiredToolId)}`)
      continue
    }
    const actual = tools[index]?.requiresCapabilities
    if (
      !Array.isArray(actual)
      || actual.length !== 1
      || actual[0]?.id !== REQUIRED_VIDEO_CAPABILITY.id
      || actual[0]?.version !== REQUIRED_VIDEO_CAPABILITY.version
    ) {
      errors.push(
        `contributes.tools[${index}].requiresCapabilities must be exactly ${JSON.stringify([REQUIRED_VIDEO_CAPABILITY])}`,
      )
    }
  }

  if (backendPath) {
    try {
      const backend = await import(/* @vite-ignore */ pathToFileURL(backendPath).href)
      const manifestToolIds = tools.map((tool) => tool?.id)
      if (backend.host === undefined) {
        errors.push('compiled backend must export named host')
      }
      const handlerKeys = Object.keys(backend.tools ?? {})
      if (
        handlerKeys.length !== manifestToolIds.length ||
        handlerKeys.some((key, index) => key !== manifestToolIds[index])
      ) {
        errors.push(
          `compiled backend named tools keys ${JSON.stringify(handlerKeys)} must equal manifest tool IDs in order ${JSON.stringify(manifestToolIds)}`,
        )
      }
    } catch (error) {
      errors.push(`entry.backend could not be imported as ESM: ${error.message}`)
    }
  }
}

async function findForbiddenProviderIntegrationText(packageRoot, errors) {
  const pending = [...PUBLISHED_TEXT_PATHS]
  while (pending.length > 0) {
    const packagePath = pending.pop()
    const absolutePath = resolve(packageRoot, packagePath)
    let info
    try {
      info = await stat(absolutePath)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      const entries = await readdir(absolutePath, { withFileTypes: true })
      for (const entry of entries) {
        pending.push(`${packagePath}/${entry.name}`)
      }
      continue
    }
    if (!info.isFile() || !isTextFile(packagePath)) continue
    const source = await readFile(absolutePath, 'utf8')
    const forbidden = FORBIDDEN_PROVIDER_INTEGRATION_TEXT.find((text) => source.includes(text))
    if (forbidden) {
      errors.push(
        `forbidden provider integration text ${JSON.stringify(forbidden)} in published file ${packagePath}`,
      )
    }
  }
}

async function validateFrontendAssetEncoding(packageRoot, errors) {
  try {
    const source = await readFile(resolve(packageRoot, 'dist/index.js'), 'utf8')
    if (source.includes(RAW_SVG_DATA_URI)) {
      errors.push('dist/index.js must percent-encode SVG data URI payloads')
    }
  } catch {
    // The package/export checks report a missing frontend bundle with its canonical path.
  }
}

export async function validateRelease(root) {
  const packageRoot = resolve(root)
  const errors = []
  const pkg = await readJson(resolve(packageRoot, 'package.json'), 'package.json', errors)
  const manifest = await readJson(
    resolve(packageRoot, 'forgeax-extension.json'),
    'forgeax-extension.json',
    errors,
  )

  if (pkg) {
    await validatePackage(packageRoot, pkg, errors)
    await validateNoLocalAbsolutePaths(packageRoot, pkg, errors)
  }
  if (manifest) await validateManifest(packageRoot, manifest, errors)
  await validateFrontendAssetEncoding(packageRoot, errors)
  await findForbiddenProviderIntegrationText(packageRoot, errors)
  if (pkg && manifest) {
    const expectedTag = `v${pkg.version}`
    if (manifest.version !== pkg.version) {
      errors.push(
        `manifest version ${JSON.stringify(manifest.version)} must equal package version ${JSON.stringify(pkg.version)} for tag ${expectedTag}`,
      )
    }
  }

  try {
    await findOldActiveIdentities(packageRoot, errors)
  } catch (error) {
    errors.push(`old active identity scan failed: ${error.message}`)
  }

  return errors
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const errors = await validateRelease(process.cwd())
  if (errors.length === 0) {
    console.log('Release package is complete and internally consistent.')
  } else {
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
  }
}
