/**
 * 开局模板 —— 把 `src/server/templates/<template>/` 整棵目录按相对路径写入游戏目录：
 * 多出来的文件直接加上，已有同名文件覆盖。宿主初始化只从 seed 落盘
 * `project.json` / `blueprint.json` / `assets/manifest.json` 三件套，这三份若在
 * createSeed 里提前写入会让 package 看起来已经 initialized，所以它们只作为 seed
 * 返回（`project.id`/`title` 换成本次 gameId），其余文件经 `context.files.write`。
 *
 * 模板 id 来自 `initializePackage` 透传的 `context.options.template`。
 * `none` / 缺省走出厂空库，不复制模板目录。
 */
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SeedContext } from '@forgeax/extension-host/node'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import {
  createEmptyLibrarySeed,
  type EmptyLibrarySeed,
  type EmptyProject,
} from './empty-library-seed'

export const VIDEO_GAME_TEMPLATES = ['none', 'tavern'] as const

export type VideoGameTemplate = (typeof VIDEO_GAME_TEMPLATES)[number]

/** 宿主 initialize 只从 seed 落盘这三份；模板里同名文件不经 files.write。 */
const TEMPLATE_PACKAGE_FILES = ['project.json', 'blueprint.json', 'assets/manifest.json'] as const
const TEMPLATE_PACKAGE_FILE_SET = new Set<string>(TEMPLATE_PACKAGE_FILES)

function templateRoot(metaUrl: string, template: string): string {
  return fileURLToPath(new URL(`../templates/${template}/`, metaUrl))
}

function toGameRelativePath(root: string, absolutePath: string): string {
  const relativePath = relative(root, absolutePath).split(sep).join('/')
  if (
    relativePath.length === 0
    || relativePath === '..'
    || relativePath.startsWith('../')
  ) {
    throw new Error('Template file path is outside the template directory')
  }
  return relativePath
}

async function listTemplateFiles(root: string): Promise<string[]> {
  const files: string[] = []
  async function walk(directory: string): Promise<void> {
    for (const name of await readdir(directory)) {
      const absolutePath = join(directory, name)
      const info = await lstat(absolutePath)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) {
        await walk(absolutePath)
        continue
      }
      if (info.isFile()) files.push(toGameRelativePath(root, absolutePath))
    }
  }
  await walk(root)
  return files
}

function seedOptions(context: SeedContext): Record<string, unknown> {
  const value = context.options
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid video game template options')
  }
  return { ...value }
}

function selectedTemplate(context: SeedContext): VideoGameTemplate {
  const template = seedOptions(context).template
  if (template === undefined) return 'none'
  const matched = VIDEO_GAME_TEMPLATES.find((candidate) => candidate === template)
  if (!matched) throw new Error('Invalid video game template options')
  return matched
}

async function readTemplateJson<T>(root: string, file: string): Promise<T> {
  return JSON.parse(await readFile(join(root, file), 'utf8')) as T
}

/** 读出选定模板的 seed，并把模板目录里的其余文件写入游戏目录。 */
export async function createVideoGameTemplateSeed(
  context: SeedContext,
): Promise<EmptyLibrarySeed> {
  const template = selectedTemplate(context)
  if (template === 'none') return createEmptyLibrarySeed(context)

  const root = templateRoot(import.meta.url, template)
  const files = await listTemplateFiles(root)
  for (const file of TEMPLATE_PACKAGE_FILES) {
    if (!files.includes(file)) {
      throw new Error(`Video game template is missing ${file}`)
    }
  }

  await Promise.all(
    files
      .filter((file) => !TEMPLATE_PACKAGE_FILE_SET.has(file))
      .map(async (file) => {
        const bytes = new Uint8Array(await readFile(join(root, file)))
        await context.files.write(file, bytes)
      }),
  )

  const [project, blueprint, assetsManifest] = (await Promise.all(
    TEMPLATE_PACKAGE_FILES.map((file) => readTemplateJson<unknown>(root, file)),
  )) as [EmptyProject, GraphLibraryDocument, EmptyLibrarySeed['assetsManifest']]

  return {
    project: { ...project, id: context.gameId, title: context.gameId },
    blueprint,
    assetsManifest,
  }
}
