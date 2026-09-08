import { describe, it, expect } from 'vitest'
import {
  audioAssetOptions,
  patchNodeBgm,
} from '@/authoring/audio/bgm-authoring'
import { patchNodeData } from '@/authoring/graph/graph-edit'
import type { ManagedAsset } from '../../assets/assetLibraryClient'
import type { GameGraph } from '@/runtime/core/schema/graph-schema'

describe('patchNodeBgm', () => {
  it('清空 ref → 整个 bgm 消失（不留 { ref: "" } 这种 validate 判错、runtime 静默丢弃的半成品）', () => {
    expect(patchNodeBgm({ ref: 'bgm-battle', mode: 'replace' }, { ref: '' })).toBeUndefined()
    expect(patchNodeBgm({ ref: 'bgm-battle' }, { ref: '   ' })).toBeUndefined()
    expect(patchNodeBgm(undefined, { mode: 'replace', restart: true })).toBeUndefined()
  })

  it('第一次填 ref 就产出可跑的最小配置（默认值不落盘）', () => {
    expect(patchNodeBgm(undefined, { ref: ' bgm-battle ' })).toEqual({ ref: 'bgm-battle' })
  })

  it('mode 默认 push 不落盘，replace 才写', () => {
    expect(patchNodeBgm({ ref: 'a', mode: 'replace' }, { mode: 'push' })).toEqual({ ref: 'a' })
    expect(patchNodeBgm({ ref: 'a' }, { mode: 'replace' })).toEqual({ ref: 'a', mode: 'replace' })
  })

  // v2 的「结束当前音乐」是一条**不带曲子**的配置（SPEC §3.3：`mode: 'stop'` 时 ref 可省）。
  // 「没有非空 ref 就删键」那条 v1 规则会让作者压根写不出它。
  it("能写出 { mode: 'stop' }（这一条不引入曲子，所以不需要 ref）", () => {
    expect(patchNodeBgm(undefined, { mode: 'stop' })).toEqual({ mode: 'stop' })
  })

  // `BgmStack.stop()` 只读**被结束那一层**的字段：fadeOutMs 取自离场帧、volume/fadeInMs 取自恢复
  // 出来的那帧，ref 更是压根不读（§3.3「给了也忽略」）。留着这些字段就是一份撒谎的配置：
  // 面板上还显示着一首永远不播的曲子。
  it('曲子 → stop：ref / 播放字段一并收掉，不留自相矛盾的残留', () => {
    const stopped = patchNodeBgm(
      { ref: 'bgm-battle', volume: 0.4, fadeInMs: 800, fadeOutMs: 600, restart: true },
      { mode: 'stop' },
    )
    expect(stopped).toEqual({ mode: 'stop' })
  })

  // 反过来离开 stop 得显式给 mode（面板的下拉就是这么写的）：此时手上没有曲子，
  // 于是回到「这里不换音乐」的空态 —— 而不是落一个 { ref: '' } 半成品。
  it('stop → 起播：手上没曲子 → 整个 bgm 键消失（回空态，作者接着填 ref）', () => {
    expect(patchNodeBgm({ mode: 'stop' }, { mode: 'push' })).toBeUndefined()
  })

  // 合起来一条规则：**merge 完还是 stop，就还是那一条**。「填了 ref 就自动脱离 stop」听着聪明，
  // 但会让下拉与输入框互相偷改对方的值；面板在 stop 下压根不渲染资产输入，所以这条走不到。
  it('stop 状态下塞 ref 不会偷偷变成起播（要离开 stop 得显式换 mode）', () => {
    expect(patchNodeBgm({ mode: 'stop' }, { ref: 'bgm-battle' })).toEqual({ mode: 'stop' })
  })

  it('restart 默认 false 不落盘（同曲续播 = 回合循环友好）', () => {
    expect(patchNodeBgm({ ref: 'a', restart: true }, { restart: false })).toEqual({ ref: 'a' })
    expect(patchNodeBgm({ ref: 'a' }, { restart: true })).toEqual({ ref: 'a', restart: true })
    expect(patchNodeBgm({ ref: 'a', restart: true }, { ref: 'b' })).toEqual({ ref: 'b', restart: true })
  })

  it('播放模式默认循环不落盘，单次播放写 loop:false', () => {
    expect(patchNodeBgm({ ref: 'a' }, { loop: false })).toEqual({ ref: 'a', loop: false })
    expect(patchNodeBgm({ ref: 'a', loop: false }, { loop: undefined })).toEqual({ ref: 'a' })
    expect(patchNodeBgm(undefined, { loop: false })).toBeUndefined()
  })

  it('只勾 restart 而没有曲子 → 仍是删键（没有曲子可重播）', () => {
    expect(patchNodeBgm(undefined, { restart: true })).toBeUndefined()
  })

  it('没有曲子时可单独写入或清除 volume', () => {
    expect(patchNodeBgm(undefined, { volume: 0.35 })).toEqual({ volume: 0.35 })
    expect(patchNodeBgm({ volume: 0.35 }, { volume: undefined })).toBeUndefined()
  })

  it('清空曲目时保留显式 volume，继续调整继承曲目', () => {
    expect(patchNodeBgm({ ref: 'a', volume: 0.4 }, { ref: '' })).toEqual({ volume: 0.4 })
  })

  it('保留面板写入的 volume 与手写 blueprint.json 里的 fade', () => {
    const kept = patchNodeBgm({ ref: 'a', volume: 0.4, fadeInMs: 800, fadeOutMs: 600 }, { mode: 'replace' })
    expect(kept).toEqual({ ref: 'a', mode: 'replace', volume: 0.4, fadeInMs: 800, fadeOutMs: 600 })
  })

  it('把越界 / 非法数值规范成合法形状（validate 只报 error，不会替作者兜底）', () => {
    expect(patchNodeBgm({ ref: 'a' }, { volume: 3 })).toEqual({ ref: 'a', volume: 1 })
    expect(patchNodeBgm({ ref: 'a' }, { volume: -1 })).toEqual({ ref: 'a', volume: 0 })
    expect(patchNodeBgm({ ref: 'a' }, { volume: Number.NaN })).toEqual({ ref: 'a' })
    expect(patchNodeBgm({ ref: 'a', fadeInMs: -5 }, {})).toEqual({ ref: 'a' })
    expect(patchNodeBgm({ ref: 'a', fadeInMs: 12.6 }, {})).toEqual({ ref: 'a', fadeInMs: 13 })
  })
})

describe('节点面板的写回路径（patchNodeData + patchNodeBgm）', () => {
  const graphWith = (bgm?: unknown): GameGraph => ({
    nodes: [{
      id: 'n1',
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: { name: 'A', ...(bgm ? { bgm } : {}) } as never,
    }],
    edges: [],
  })

  it('没有显式音量时清空音乐 → data 上不再有 bgm 键', () => {
    const g = patchNodeData(graphWith({ ref: 'bgm-battle', restart: true }), 'n1', {
      bgm: patchNodeBgm({ ref: 'bgm-battle', restart: true }, { ref: '' }),
    })
    expect('bgm' in g.nodes[0]!.data).toBe(false)
  })

  it('填音乐 → data.bgm 落成最小合法形状', () => {
    const g = patchNodeData(graphWith(), 'n1', { bgm: patchNodeBgm(undefined, { ref: 'bgm-battle' }) })
    expect(g.nodes[0]!.data.bgm).toEqual({ ref: 'bgm-battle' })
  })
})

describe('audio picker fallbacks', () => {
  const resource = (id: string, name?: string): ManagedAsset => ({
    id,
    kind: 'audio',
    name: name ?? id,
  })

  it('名字优先，缺名字用 id；重复 id 去重', () => {
    expect(audioAssetOptions([
      resource('aud-1', '战斗床'),
      resource('aud-2'),
      resource('aud-1', '战斗床副本'),
    ])).toEqual([
      { id: 'aud-1', label: '战斗床' },
      { id: 'aud-2', label: 'aud-2' },
    ])
  })
})
