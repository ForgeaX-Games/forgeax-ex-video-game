/**
 * intake/characters —— **只读**跨模块适配器：把 character 已产出的角色立绘映射成
 * 本 registry 的 `character_ref` 条目（externalPath 指回对方文件，**不复制、不写对方目录**）。
 *
 * character 磁盘契约（勘察自其 storage.ts / types.ts）：
 *   `.forgeax/games/<slug>/characters/<charId>/manifest.json`
 *      { schemaVersion, charId, name, role?, portrait: { front?|side?|back?: "portrait/<view>.<ext>" },
 *        pipelines?: { turnaround?: { views: { front?: "turnaround/front.<ext>", ... } } } }
 *   立绘文件为相对 `<charId>/` 的相对路径；扩展名按字节嗅探（png/jpg/webp）。
 *
 * 幂等：ref id 由 charId 稳定派生（`a-charref-<charId>`），重扫覆盖同一条目。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import {
  createHostAssetRegistry,
  mimeForPath,
  upsertAsset,
  type HostAssetRegistry,
} from '../asset-registry'
import type { MediaAsset } from '@/authoring/assets/registry-types'

interface CharManifest {
  charId?: string
  name?: string
  role?: string
  portrait?: Record<string, string>
  pipelines?: { turnaround?: { views?: Record<string, string> } }
}

/** 从一个角色 manifest 里挑一张最合适的立绘相对路径（front 优先，其次任意）。 */
function pickPortraitRel(m: CharManifest): string | undefined {
  const p = m.portrait ?? {}
  return (
    p.front ??
    p.current ??
    p.three_quarter ??
    Object.values(p).find(Boolean) ??
    m.pipelines?.turnaround?.views?.front ??
    Object.values(m.pipelines?.turnaround?.views ?? {}).find(Boolean)
  )
}

/**
 * 扫描 charactersDir 下每个 `<charId>/manifest.json`，为有立绘的角色 upsert 一条只读
 * `character_ref` 到本 registry。返回落盘后的 ref 列表。charactersDir 不存在 → 空。
 */
export function importCharacterRefs(opts: { assetsDir: string; charactersDir: string }): MediaAsset[] {
  const { assetsDir, charactersDir } = opts
  if (!existsSync(charactersDir)) return []
  const out: MediaAsset[] = []
  let entries: string[]
  try {
    entries = readdirSync(charactersDir)
  } catch {
    return []
  }
  for (const charId of entries) {
    const charDir = resolve(charactersDir, charId)
    const manifestPath = resolve(charDir, 'manifest.json')
    if (!existsSync(manifestPath)) continue
    let m: CharManifest
    try {
      if (!statSync(charDir).isDirectory()) continue
      m = JSON.parse(readFileSync(manifestPath, 'utf-8')) as CharManifest
    } catch {
      continue
    }
    const rel = pickPortraitRel(m)
    if (!rel) continue
    const externalPath = resolve(charDir, rel)
    if (!existsSync(externalPath)) continue
    out.push(
      upsertAsset(assetsDir, {
        id: `a-charref-${charId}`,
        kind: 'image',
        productionType: 'character_ref',
        status: 'ready',
        label: m.name || charId,
        externalPath,
        sourceModule: 'character',
        mime: mimeForPath(externalPath),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        meta: { charId, role: m.role },
      }),
    )
  }
  return out
}

function safeCharacterId(value: string): boolean {
  return (
    value.length > 0
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
  )
}

function boundedPortraitPath(charId: string, value: string): string {
  const normalized = value.replace(/\\/g, '/')
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new TypeError('Character portrait must be a bounded relative path')
  }
  return `characters/${charId}/${normalized}`
}

/**
 * Scans the existing character directory contract through the host's
 * bounded directory listing. Reference bytes are copied into host media; no
 * source path is stored in the registry or returned to callers.
 */
export async function importCharacterRefsFromHost(
  context: ExtensionContext,
  registry: HostAssetRegistry = createHostAssetRegistry(context),
): Promise<MediaAsset[]> {
  const entries = await context.files.list('characters')
  const refs: MediaAsset[] = []
  for (const charId of entries) {
    if (!safeCharacterId(charId)) continue
    const manifestBytes = await context.files.read(
      `characters/${charId}/manifest.json`,
    )
    if (!manifestBytes) continue
    let manifest: CharManifest
    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as CharManifest
    } catch {
      continue
    }
    if (manifest.charId !== undefined && manifest.charId !== charId) continue
    const portrait = pickPortraitRel(manifest)
    if (typeof portrait !== 'string' || !portrait) continue
    try {
      const relativePath = boundedPortraitPath(charId, portrait)
      const mime = mimeForPath(portrait)
      refs.push(await registry.importGameFile({
        registryId: `a-charref-${charId}`,
        relativePath,
        filename: `character-${charId.replace(/[^a-z0-9_-]+/gi, '-') || 'character'}.${mime.split('/')[1] ?? 'png'}`,
        contentType: mime,
        productionType: 'character_ref',
        label: manifest.name || charId,
        sourceModule: 'character',
        meta: { charId, role: manifest.role },
      }))
    } catch (error) {
      if (
        error instanceof Error
        && (
          error instanceof TypeError
          || error.message.startsWith('Reference media was not found:')
        )
      ) {
        continue
      }
      throw error
    }
  }
  return refs
}
