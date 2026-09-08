import { mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RuntimeRegistry,
  createExtensionHost,
  createPathBoundedGameFilesForDevelopment,
  mergeManifestLayers,
} from '@forgeax/extension-host/node'
import type {
  GameFileCapability,
  GameVersionCapability,
  MediaAsset,
  MediaBody,
  MediaCapability,
  MediaQuery,
  MediaWriteInput,
  ModelGateway,
  VersionAdapter,
  WorkspaceAdapter,
} from '@forgeax/extension-host/contracts'

const packageFiles = [
  'project.json',
  'blueprint.json',
  'assets/manifest.json',
] as const

function assertGameId(gameId: string): void {
  if (!gameId || gameId === '.' || gameId === '..' || /[\\/]/.test(gameId)) {
    throw new TypeError('Game id must be a non-empty logical identifier')
  }
}

function within(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !path.startsWith(`..${sep}`))
}

class LocalDevWorkspace implements WorkspaceAdapter {
  private readonly gamesRoot: string

  constructor(gamesRoot: string) {
    this.gamesRoot = realpathSync(gamesRoot)
  }

  private async openGameRoot(gameId: string, create: boolean): Promise<string> {
    assertGameId(gameId)
    const candidate = resolve(this.gamesRoot, gameId)
    if (!within(this.gamesRoot, candidate)) throw new TypeError('Game root is outside development workspace')
    if (create) await mkdir(candidate, { recursive: true })
    let resolvedCandidate: string
    try {
      resolvedCandidate = realpathSync(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // A fresh Extension game has no files yet. Materialize only the
        // bounded development directory so package status can report the
        // contract's `uninitialized` state instead of a workspace 404.
        await mkdir(candidate, { recursive: true })
        resolvedCandidate = realpathSync(candidate)
      } else {
        throw error
      }
    }
    if (!within(this.gamesRoot, resolvedCandidate)) {
      throw new TypeError('Game root is outside development workspace')
    }
    return resolvedCandidate
  }

  async resolveGameRoot(gameId: string): Promise<string> {
    return this.openGameRoot(gameId, false)
  }

  /**
   * Development-only revocable scope. Production embedding hosts must provide
   * the native/RPC directory authority required by WorkspaceAdapter.
   */
  async withGameRoot<T>(
    gameId: string,
    options: Parameters<WorkspaceAdapter['withGameRoot']>[1],
    operation: Parameters<WorkspaceAdapter['withGameRoot']>[2],
  ): Promise<T> {
    const gameRoot = await this.openGameRoot(gameId, options.create)
    const bounded = createPathBoundedGameFilesForDevelopment(gameRoot)
    let active = true
    const assertActive = (): void => {
      if (!active) throw new Error('Development game scope is closed')
    }
    const files: GameFileCapability = {
      async list(path) {
        assertActive()
        return bounded.list(path)
      },
      async read(path) {
        assertActive()
        return bounded.read(path)
      },
      async write(path, contents) {
        assertActive()
        await bounded.write(path, contents)
      },
      async delete(path) {
        assertActive()
        await bounded.delete(path)
      },
      async withLocks(keys, work) {
        assertActive()
        return bounded.withLocks(keys, async () => {
          assertActive()
          return work()
        })
      },
    }
    const versions: GameVersionCapability = {
      async ensureRepository() {
        assertActive()
        await options.versioning.ensureRepository(gameRoot)
      },
      async createVersion(message) {
        assertActive()
        return options.versioning.createVersion(gameRoot, message)
      },
      async createCheckpoint(message) {
        assertActive()
        return options.versioning.createCheckpoint(gameRoot, message)
      },
      async currentVersion() {
        assertActive()
        return options.versioning.currentVersion(gameRoot)
      },
      async listVersions() {
        assertActive()
        return options.versioning.listVersions(gameRoot)
      },
      async readFileAtVersion(tag, path) {
        assertActive()
        return options.versioning.readFileAtVersion(gameRoot, tag, path)
      },
    }
    try {
      return await operation({ gameRoot, files, versions }) as T
    } finally {
      active = false
    }
  }
}

class LocalDevVersions implements VersionAdapter {
  private readonly versions = new Map<string, Array<{
    tag: string
    commitHash: string
    message: string
    createdAt: string
    files: Map<string, Uint8Array>
  }>>()

  async ensureRepository(gameRoot: string): Promise<void> {
    await mkdir(gameRoot, { recursive: true })
  }

  async createVersion(gameRoot: string, message: string) {
    const history = this.versions.get(gameRoot) ?? []
    const files = new Map<string, Uint8Array>()
    for (const path of packageFiles) {
      try {
        files.set(path, new Uint8Array(await readFile(resolve(gameRoot, path))))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    const sequence = history.length + 1
    const version = {
      tag: `dev-${sequence}`,
      commitHash: `local-${sequence}`,
      message,
      createdAt: new Date().toISOString(),
      files,
    }
    history.push(version)
    this.versions.set(gameRoot, history)
    return { ...version, files: undefined } as {
      tag: string
      commitHash: string
      message: string
      createdAt: string
    }
  }

  // Mirrors the host InMemoryVersionAdapter semantics: identical tip is an
  // idempotent no-op (`created: false`), and checkpoints never show up as
  // user-visible versions.
  async createCheckpoint(gameRoot: string, message: string) {
    const history = this.versions.get(gameRoot) ?? []
    const files = new Map<string, Uint8Array>()
    for (const path of packageFiles) {
      try {
        files.set(path, new Uint8Array(await readFile(resolve(gameRoot, path))))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    const latest = history.at(-1)
    const same = latest !== undefined
      && files.size === latest.files.size
      && [...files.entries()].every(([path, bytes]) => {
        const previous = latest.files.get(path)
        return previous !== undefined
          && previous.byteLength === bytes.byteLength
          && previous.every((value, index) => value === bytes[index])
      })
    if (same && latest) {
      return {
        commitHash: latest.commitHash,
        message,
        createdAt: latest.createdAt,
        created: false,
      }
    }
    const sequence = history.length + 1
    const checkpoint = {
      tag: `checkpoint-${sequence}`,
      commitHash: `local-checkpoint-${sequence}`,
      message,
      createdAt: new Date().toISOString(),
      files,
    }
    history.push(checkpoint)
    this.versions.set(gameRoot, history)
    return {
      commitHash: checkpoint.commitHash,
      message,
      createdAt: checkpoint.createdAt,
      created: true,
    }
  }

  async currentVersion(gameRoot: string) {
    const version = this.versions.get(gameRoot)?.at(-1)
    return version
      ? { tag: version.tag, commitHash: version.commitHash, dirty: false }
      : null
  }

  async listVersions(gameRoot: string) {
    return (this.versions.get(gameRoot) ?? [])
      .filter((version) => version.tag.startsWith('dev-'))
      .map((version) => ({
        tag: version.tag,
        commitHash: version.commitHash,
        message: version.message,
        createdAt: version.createdAt,
      }))
  }

  async readFileAtVersion(gameRoot: string, tag: string, path: string) {
    const bytes = this.versions.get(gameRoot)
      ?.find((version) => version.tag === tag)
      ?.files.get(path)
    return bytes ? new Uint8Array(bytes) : null
  }
}

class InMemoryDevMedia implements MediaCapability {
  private readonly assets = new Map<string, Map<string, { asset: MediaAsset; body: MediaBody }>>()
  private readonly receipts = new Map<string, { signature: string; asset: MediaAsset }>()

  async list(gameId: string, query: MediaQuery = {}): Promise<MediaAsset[]> {
    const assets = [...(this.assets.get(gameId)?.values() ?? [])]
      .map(({ asset }) => structuredClone(asset))
      .filter((asset) => !query.type || asset.type === query.type)
    return assets.slice(0, query.limit ?? assets.length)
  }

  async read(gameId: string, assetId: string): Promise<MediaBody | null> {
    const body = this.assets.get(gameId)?.get(assetId)?.body
    return body
      ? { contentType: body.contentType, bytes: new Uint8Array(body.bytes) }
      : null
  }

  async put(gameId: string, input: MediaWriteInput): Promise<MediaAsset> {
    const signature = createHash('sha256')
      .update(input.filename)
      .update('\0')
      .update(input.contentType)
      .update('\0')
      .update(input.bytes)
      .update('\0')
      .update(JSON.stringify(input.metadata ?? null))
      .digest('hex')
    const receiptKey = input.idempotencyKey
      ? `${gameId}\0${input.idempotencyKey}`
      : undefined
    const receipt = receiptKey ? this.receipts.get(receiptKey) : undefined
    if (receipt) {
      if (receipt.signature !== signature) {
        throw new Error('Media idempotency key was reused with a different payload')
      }
      return structuredClone(receipt.asset)
    }
    const type = input.contentType.startsWith('image/')
      ? 'image'
      : input.contentType.startsWith('video/') ? 'video' : 'audio'
    const asset: MediaAsset = {
      id: `${gameId}:${input.filename}`,
      type,
      url: `memory://${encodeURIComponent(gameId)}/${encodeURIComponent(input.filename)}`,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      ...(input.metadata ? { metadata: structuredClone(input.metadata) } : {}),
    }
    const gameAssets = this.assets.get(gameId) ?? new Map()
    gameAssets.set(asset.id, {
      asset: structuredClone(asset),
      body: { contentType: input.contentType, bytes: new Uint8Array(input.bytes) },
    })
    this.assets.set(gameId, gameAssets)
    if (receiptKey) {
      this.receipts.set(receiptKey, { signature, asset: structuredClone(asset) })
    }
    return structuredClone(asset)
  }

  async delete(gameId: string, assetId: string): Promise<void> {
    this.assets.get(gameId)?.delete(assetId)
  }
}

const unavailableModels: ModelGateway = {
  async generateText() { throw new Error('Development host has no model gateway; inject one from the embedding host') },
  async generateImage() { throw new Error('Development host has no model gateway; inject one from the embedding host') },
  async generateVideo() { throw new Error('Development host has no model gateway; inject one from the embedding host') },
}

export interface CreateDevExtensionHostOptions {
  readonly extensionRoot?: string
  readonly gamesRoot?: string
  readonly media?: MediaCapability
  readonly models?: ModelGateway
}

export function resolveDevGamesRoot(
  extensionRoot: string,
  gamesRoot?: string,
): string {
  return resolve(gamesRoot ?? resolve(extensionRoot, '.extension-dev', 'games'))
}

/**
 * Local development composition root. It uses the same host HTTP contract as
 * production while keeping workspace files local and media memory-backed.
 */
export function createDevExtensionHost(
  options: CreateDevExtensionHostOptions = {},
) {
  const extensionRoot = realpathSync(
    options.extensionRoot ?? resolve(fileURLToPath(new URL('../..', import.meta.url))),
  )
  const gamesRoot = resolveDevGamesRoot(extensionRoot, options.gamesRoot)
  mkdirSync(gamesRoot, { recursive: true })
  const rawManifest = JSON.parse(readFileSync(resolve(extensionRoot, 'forgeax-extension.json'), 'utf8'))
  const registry = new RuntimeRegistry()
  registry.register({
    manifest: mergeManifestLayers([rawManifest]),
    packageRoot: extensionRoot,
    frontendEntry: 'index.html',
    // The Vite plugin runs in Node and the trusted backend loader uses native
    // dynamic import, so the dev host must consume the tsup watcher output.
    backendEntry: 'dist/server/host.js',
  })

  return createExtensionHost({
    registry,
    workspace: new LocalDevWorkspace(gamesRoot),
    versioning: new LocalDevVersions(),
    media: options.media ?? new InMemoryDevMedia(),
    models: options.models ?? unavailableModels,
    isExtensionTrusted: () => true,
  })
}
