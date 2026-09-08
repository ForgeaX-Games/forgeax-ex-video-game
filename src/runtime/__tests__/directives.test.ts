import { describe, expect, it } from 'vitest'
import {
  isBgm,
  isPlayClip,
  isRenderOverlay,
  type RuntimeDirective,
} from '../core/engine/directives'
import { BgmStack } from '../core/engine/bgm-stack'

describe('directives', () => {
  it('constructs directive literals', () => {
    const play: RuntimeDirective = { type: 'playClip', nodeId: 'n1', name: '开场', loop: false }
    const overlay: RuntimeDirective = {
      type: 'renderOverlay',
      nodeId: 'n1',
      mountId: 'hpPanel',
      elementId: 'e1',
      component: 'floatText',
      inputs: { text: '+30', timeoutMs: 3000, defaultEvent: 'b' },
    }
    expect(play.type).toBe('playClip')
    expect(overlay.component).toBe('floatText')
    expect(overlay.inputs.timeoutMs).toBe(3000)
    expect(overlay.inputs.defaultEvent).toBe('b')
  })

  it('type guards discriminate renderOverlay', () => {
    const overlay: RuntimeDirective = {
      type: 'renderOverlay',
      nodeId: 'n',
      mountId: 'm1',
      elementId: 'e',
      component: 'x',
      inputs: {},
    }
    const play: RuntimeDirective = { type: 'playClip', nodeId: 'n', name: 'x', loop: false }
    expect(isRenderOverlay(overlay)).toBe(true)
    expect(isRenderOverlay(play)).toBe(false)
  })

  it('bgm directive carries a BgmStack playback command verbatim (只加 type tag)', () => {
    const stack = new BgmStack()
    const cmd = stack.apply({ owner: 'combat', ref: 'bgm-battle', volume: 0.8, fadeInMs: 500 })
    const bgm: RuntimeDirective = { type: 'bgm', ...cmd }
    expect(bgm).toEqual({
      type: 'bgm',
      ref: 'bgm-battle',
      volume: 0.8,
      fadeInMs: 500,
      fadeOutMs: 0,
      loop: true,
      restart: true,
    })
  })

  it('type guards discriminate bgm', () => {
    const stack = new BgmStack()
    stack.apply({ owner: 'combat', ref: 'bgm-battle', fadeOutMs: 800 })
    // 离场指令：ref: null = 停播，只有 fadeOutMs 有意义。
    const stop: RuntimeDirective = { type: 'bgm', ...stack.stop()! }
    const play: RuntimeDirective = { type: 'playClip', nodeId: 'n', name: 'x', loop: false }
    expect(isBgm(stop)).toBe(true)
    expect(isBgm(play)).toBe(false)
    expect(isPlayClip(stop)).toBe(false)
    expect(isRenderOverlay(stop)).toBe(false)
    if (!isBgm(stop)) throw new Error('unreachable')
    expect(stop.ref).toBeNull() // 收窄后可直接读 BGM 字段
    expect(stop.fadeOutMs).toBe(800)
  })
})
