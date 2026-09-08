import { describe, expect, it } from 'vitest'
import {
  getNodeBgm,
  type DocumentBgm,
  type GameNodeData,
  type GameScenario,
  type NodeBgm,
  type NodeData,
  type SubProcessNodeData,
  type SubFlowPackNodeData,
} from '../core/schema/graph-schema'

describe('getNodeBgm', () => {
  it('returns undefined when missing', () => {
    expect(getNodeBgm({ name: 'x' })).toBeUndefined()
  })

  it('returns bgm when present', () => {
    const d: NodeData = { name: 'c', bgm: { ref: 'bgm-battle', mode: 'push' } }
    expect(getNodeBgm(d)?.ref).toBe('bgm-battle')
  })

  it('reads bgm off subProcess / subFlowPack 容器（NodeData 基类字段，容器自动继承）', () => {
    const sub: SubProcessNodeData = {
      name: 'wait',
      subProcess: { entry: 'wait', graph: { nodes: [], edges: [] } },
      bgm: { ref: 'bgm-wait' },
    }
    const pack: SubFlowPackNodeData = {
      name: 'combat',
      subFlowPack: { id: 'bp-combat', entry: 'enter' },
      bgm: { ref: 'bgm-battle', restart: false, fadeInMs: 800, fadeOutMs: 600 },
    }
    expect(getNodeBgm(sub)?.ref).toBe('bgm-wait')
    expect(getNodeBgm(pack)?.ref).toBe('bgm-battle')
    expect(getNodeBgm(pack)?.restart).toBe(false)
  })

  it('mode: stop 不带 ref 也是合法配置，不能被丢掉（否则「结束音乐」静默失效）', () => {
    const win: NodeData = { name: 'win', bgm: { mode: 'stop' } }
    expect(getNodeBgm(win)).toEqual({ mode: 'stop' })
    // ref 给了也留着（runtime 忽略，validate 不管）；空 ref 同样不影响 stop
    expect(getNodeBgm({ name: 'lose', bgm: { mode: 'stop', ref: '' } })).toEqual({ mode: 'stop', ref: '' })
    expect(getNodeBgm({ name: 'l2', bgm: { mode: 'stop', fadeOutMs: 600 } })?.mode).toBe('stop')
  })

  it('volume-only 不带 ref 也是合法配置，用于调整当前曲目音量', () => {
    expect(getNodeBgm({ name: 'quiet', bgm: { volume: 0.35 } })).toEqual({ volume: 0.35 })
  })

  it('防御性丢弃非法形状（非对象 / ref 非 string / ref 空串且不是 stop）', () => {
    const bad = (bgm: unknown): GameNodeData => ({ name: 'x', bgm } as unknown as GameNodeData)
    expect(getNodeBgm(bad(null))).toBeUndefined()
    expect(getNodeBgm(bad('bgm-battle'))).toBeUndefined()
    expect(getNodeBgm(bad({}))).toBeUndefined()
    expect(getNodeBgm(bad({ ref: '' }))).toBeUndefined()
    expect(getNodeBgm(bad({ ref: 42 }))).toBeUndefined()
    expect(getNodeBgm(bad({ volume: -0.1 }))).toBeUndefined()
    expect(getNodeBgm(bad({ volume: 1.1 }))).toBeUndefined()
    expect(getNodeBgm(bad({ volume: Number.NaN }))).toBeUndefined()
    // 只填了 mode / fade 等参数却没曲子、也不是 stop → 无从起播，丢弃
    expect(getNodeBgm(bad({ mode: 'push' }))).toBeUndefined()
    expect(getNodeBgm(bad({ mode: 'replace', fadeInMs: 800 }))).toBeUndefined()
    expect(getNodeBgm(bad({ restart: true }))).toBeUndefined()
    // mode 得是真的 'stop' 字符串，不吃真值糖
    expect(getNodeBgm(bad({ mode: 'STOP' }))).toBeUndefined()
  })
})

describe('bgm schema 形状', () => {
  it('GameScenario.bgm 可选，缺省的旧图照常成立', () => {
    const withoutBgm: GameScenario = { version: '1', graph: { nodes: [], edges: [] } }
    expect(withoutBgm.bgm).toBeUndefined()

    const bgm: DocumentBgm = { ref: 'bgm-story', volume: 0.8, fadeInMs: 1200, loop: true }
    const withBgm: GameScenario = { version: '1', graph: { nodes: [], edges: [] }, bgm }
    expect(withBgm.bgm?.ref).toBe('bgm-story')
  })

  it('NodeBgm.mode 三态 push / replace / stop；ref 在 stop 或 volume-only 时可省', () => {
    const push: NodeBgm = { ref: 'a', mode: 'push' }
    const replace: NodeBgm = { ref: 'b', mode: 'replace', volume: 1, fadeInMs: 0, fadeOutMs: 0, restart: true }
    const stop: NodeBgm = { mode: 'stop', fadeOutMs: 600 }
    const bare: NodeBgm = { ref: 'd' }
    const volumeOnly: NodeBgm = { volume: 0.4 }
    expect([push.mode, replace.mode, stop.mode, bare.mode]).toEqual(['push', 'replace', 'stop', undefined])
    expect(stop.ref).toBeUndefined()
    expect(volumeOnly.ref).toBeUndefined()
  })
})
