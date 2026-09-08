import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { validateProjectForActivity } from './project-inspection'

const encoder = new TextEncoder()

/**
 * 文档完成门的内容校验。
 *
 * `document.pillar.ready` 曾经只查「文件登记了」，
 * 于是一份只有标题的支柱文档也能过门；下游总脉络拿着空壳文档开工，
 * 问题会在几步之后以「声明不齐」之类的形式爆出来，很难回溯到真正的源头。
 */

const PILLAR_BODY = [
  '# 游戏支柱',
  '## 角色',
  '武松：性烈如火的行者，主角。老虎：景阳冈的猛兽，最终对手。',
  '## 场景',
  '景阳冈山道、山神庙、酒家。夜色与月光是统一的视觉基调。',
  '## 主循环',
  '玩家在对峙中选择进攻或防守，消耗气力换取伤害窗口，气力耗尽即失败。',
  '## 数值',
  '气力、酒意、虎威三个变量互相牵制，伤害由公式结算。',
].join('\n')

const CORE_BODY = [
  '# 核心方向',
  '## 主循环',
  '以回合对峙为主循环：玩家读虎的动作预兆，选择闪避或反击，',
  '每次选择都改变气力与虎威，最终在气力耗尽前打出决胜一击。',
  '故事围绕武松从醉意到清醒的转变展开，节奏是紧张与喘息交替。',
].join('\n')

function context(documents: Array<{ documentType: string, content: string }>): ExtensionContext {
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify({
      revision: 1,
      manifest: { mainPackId: 'main', packs: {} },
      graph: { nodes: [], edges: [] },
    }))],
  ])
  const assets = documents.map((document, index) => {
    const ref = `docs/wusong_${document.documentType}.md`
    files.set(ref, encoder.encode(document.content))
    return {
      id: `doc-${document.documentType}`,
      kind: 'document',
      name: document.documentType,
      status: 'ready',
      mimeType: 'text/markdown',
      provider: { kind: 'local', ref },
      createdAt: index + 1,
      updatedAt: index + 1,
      meta: { documentType: document.documentType },
    }
  })
  files.set('assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets })))
  return {
    gameId: 'wusong',
    files: {
      async read(path: string) { return files.get(path) ?? null },
      async write(path: string, bytes: Uint8Array) { files.set(path, bytes) },
      async list(path: string) {
        const prefix = `${path.replace(/\/+$/, '')}/`
        return [...new Set([...files.keys()]
          .filter((entry) => entry.startsWith(prefix))
          .map((entry) => entry.slice(prefix.length).split('/', 1)[0]!))].sort()
      },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    media: { async list() { return [] }, async read() { return null } },
  } as unknown as ExtensionContext
}

async function status(
  documents: Array<{ documentType: string, content: string }>,
  checkId: string,
): Promise<{ status: string, codes: string[] }> {
  const activity = checkId.includes('pillar') ? 'document.pillar' : 'document.core'
  const result = await validateProjectForActivity(context(documents), activity, 1, [checkId])
  const evidence = result.evidence[0]!
  return { status: evidence.status, codes: (evidence.issues ?? []).map((entry) => entry.code) }
}

describe('文档完成门的内容校验', () => {
  it('完整支柱文档通过', async () => {
    const result = await status([{ documentType: 'pillar', content: PILLAR_BODY }], 'document.pillar.ready')
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'pass' })
  })

  it('只有标题的支柱文档不通过', async () => {
    const result = await status(
      [{ documentType: 'pillar', content: '# 游戏支柱' }],
      'document.pillar.ready',
    )

    expect(result.status).toBe('fail')
    expect(result.codes).toContain('document.pillar.too-thin')
  })

  it('支柱没谈到角色与场景时不通过：总脉络要靠它分派三条线', async () => {
    const withoutCast = [
      '# 游戏支柱',
      '## 主循环',
      '玩家在对峙中反复选择进攻或防守，通过消耗气力换取伤害窗口。',
      '整体节奏是紧张与喘息交替，失败与胜利都有明确终局。',
      '数值上由气力与虎威两个变量互相牵制，伤害由公式结算，',
      '每一次选择都会改变下一回合的可用动作与风险。',
    ].join('\n')

    const result = await status([{ documentType: 'pillar', content: withoutCast }], 'document.pillar.ready')

    expect(result.status).toBe('fail')
    expect(result.codes).toContain('document.pillar.missing-section')
  })

  it('核心方向必须谈到主循环', async () => {
    expect(await status([{ documentType: 'core', content: CORE_BODY }], 'document.core.ready'))
      .toMatchObject({ status: 'pass' })

    const vague = ['# 核心方向', '做一个武松打虎的互动短片，气质悲壮，篇幅短。'].join('\n')
    const result = await status([{ documentType: 'core', content: vague }], 'document.core.ready')
    expect(result.codes).toContain('document.core.missing-section')
  })

  it('文档缺失时报缺失，而不是内容问题', async () => {
    const result = await status([], 'document.pillar.ready')

    expect(result.status).toBe('fail')
    expect(result.codes).toContain('document.pillar.missing')
  })

})
