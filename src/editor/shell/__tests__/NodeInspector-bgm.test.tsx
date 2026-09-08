/**
 * 节点面板「BGM」的读写。
 * 关键不变量：清空音乐 = `data.bgm` 整个键消失（留 `{ ref: '' }` 会被 validate 判 error、
 * 被 runtime 静默丢弃，作者只会听到「没响」）。
 * 控件与「视频」同款：`<select>` +「（空）」+ 库外 id 禁用展示。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameGraph, GameNodeData } from '@/runtime/core/schema/graph-schema'
import { NodeInspector } from '../NodeInspector'
import type { AudioOption } from '@/authoring/audio/bgm-authoring'

/** 「播放动作」下拉（面板里 select 很多，按它自己的 tooltip 定位）。 */
const modeSelect = () => screen.getByTitle(/起播并记住/) as HTMLSelectElement
/** 「BGM曲目」资产下拉（与视频字段同款）。 */
const audioSelect = () => screen.getByTitle(/与资产库音频一致/) as HTMLSelectElement
/** 勾选框按可及名字取（行容器是 `<label>`，名字含行内文字）。 */
const checkbox = (name: RegExp) => screen.getByRole('checkbox', { name })
const queryCheckbox = (name: RegExp) => screen.queryByRole('checkbox', { name })
const volumeSlider = () => screen.getByRole('slider', { name: /音量/ }) as HTMLInputElement
const queryVolumeSlider = () => screen.queryByRole('slider', { name: /音量/ }) as HTMLInputElement | null
/** 静音开关：勾上 = `volume: 0`，滑杆整条收起。 */
const muteToggle = () => screen.getByRole('checkbox', { name: '静音' }) as HTMLInputElement

const LIB: AudioOption[] = [
  { id: 'a-aud-battle', label: '战斗床 (a-aud-battle)' },
  { id: 'a-aud-boss', label: 'Boss 床 (a-aud-boss)' },
]

function node(id: string, data: Partial<GameNodeData> & { name: string }) {
  return { id, type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [], data: data as GameNodeData }
}

function graphWith(data: Partial<GameNodeData> & { name: string }): GameGraph {
  return { nodes: [node('n1', data)], edges: [] }
}

function renderPanel(graph: GameGraph, audioOptions: AudioOption[] = LIB) {
  const onChange = vi.fn()
  render(<NodeInspector graph={graph} nodeId="n1" audioOptions={audioOptions} onChange={onChange} />)
  return onChange
}

/**
 * 受控宿主：把面板吐出的图**装回去**，复现真实反馈环（GraphStudio 的 setGraph）。
 * 静态 parent 会掩盖「打字中途写坏数据」这类缺陷——props 不变，第二次改动仍看到旧 data。
 */
function renderControlled(initial: GameGraph, audioOptions: AudioOption[] = LIB, nodeId = 'n1'): () => Record<string, unknown> {
  const seen: GameGraph[] = [initial]
  function Host(): JSX.Element {
    const [graph, setGraph] = useState(initial)
    return (
      <NodeInspector
        graph={graph}
        nodeId={nodeId}
        audioOptions={audioOptions}
        onChange={(g) => { seen.push(g); setGraph(g) }}
      />
    )
  }
  render(<Host />)
  return () => seen.at(-1)!.nodes.find((n) => n.id === nodeId)!.data as unknown as Record<string, unknown>
}

/** 最近一次 onChange 拿到的 n1 data。 */
function lastData(onChange: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const g = onChange.mock.calls.at(-1)![0] as GameGraph
  return g.nodes[0]!.data as unknown as Record<string, unknown>
}

afterEach(cleanup)

describe('NodeInspector · 作用域 BGM', () => {
  it('显示统一后的 BGM 配置术语', () => {
    renderPanel(graphWith({ name: 'A' }))
    expect(screen.getByText('BGM')).toBeTruthy()
    expect(screen.getByText('播放动作')).toBeTruthy()
    expect(screen.getByText('BGM曲目')).toBeTruthy()
    expect(screen.queryByText('音乐（作用域 BGM）')).toBeNull()
    expect(screen.queryByText('音乐动作')).toBeNull()
  })

  // 「播放动作」在空态也得在：`{ mode: 'stop' }` 是一条**没有 ref** 的配置，若把下拉藏到「填了
  // ref 之后」，作者永远选不到「结束当前音乐」——v2 最常用的那条写法（win/lose）就写不出来。
  it('没配 bgm 时仍出「播放动作」下拉，但不出重进选项', () => {
    renderPanel(graphWith({ name: 'A' }))
    expect(audioSelect().value).toBe('')
    expect(modeSelect().value).toBe('push')
    expect(queryCheckbox(/从头重播/)).toBeNull()
  })

  it('选 ref → data.bgm 落最小形状；随后才出 restart', () => {
    const onChange = renderPanel(graphWith({ name: 'A' }))
    fireEvent.change(audioSelect(), { target: { value: 'a-aud-battle' } })
    expect(lastData(onChange).bgm).toEqual({ ref: 'a-aud-battle' })

    cleanup()
    renderPanel(graphWith({ name: 'A', bgm: { ref: 'a-aud-battle' } }))
    expect(checkbox(/从头重播/)).toBeTruthy()
  })

  it('有曲目时显示循环/单次播放模式，没曲目时隐藏', () => {
    renderPanel(graphWith({ name: 'A' }))
    expect(screen.queryByRole('combobox', { name: 'BGM 播放模式' })).toBeNull()
    cleanup()
    const data = renderControlled(graphWith({ name: 'A', bgm: { ref: 'a-aud-battle' } }))
    const playMode = screen.getByRole('combobox', { name: 'BGM 播放模式' }) as HTMLSelectElement
    expect(playMode.value).toBe('loop')
    fireEvent.change(playMode, { target: { value: 'once' } })
    expect(data().bgm).toEqual({ ref: 'a-aud-battle', loop: false })
  })

  // 没写 volume = 跟随上层音量，面板按有声呈现（滑杆 100%）：作者要调音量直接拖，
  // 不必先勾一个「启用音量」的开关。
  it('未设音量时按有声呈现，拖动即按 0..1 写回', () => {
    const data = renderControlled(graphWith({ name: 'A', bgm: { ref: 'a-aud-battle' } }))
    expect(volumeSlider().value).toBe('1')
    expect(volumeSlider().disabled).toBe(false)
    expect(muteToggle().checked).toBe(false)

    fireEvent.change(volumeSlider(), { target: { value: '0.35' } })
    expect(data().bgm).toEqual({ ref: 'a-aud-battle', volume: 0.35 })
    expect(screen.getByText('35%')).toBeTruthy()
    expect(volumeSlider().classList.contains('ni-bgm-volume')).toBe(true)
    expect(volumeSlider().style.padding).toBe('0px')
    fireEvent.change(volumeSlider(), { target: { value: '1' } })
    expect(data().bgm).toEqual({ ref: 'a-aud-battle', volume: 1 })
    expect(volumeSlider().style.background).toContain('100%')
  })

  it('静音勾选落 volume 0 并收起滑杆，取消静音回到有声', () => {
    const data = renderControlled(graphWith({ name: 'A', bgm: { ref: 'a-aud-battle', volume: 0.35 } }))
    expect(muteToggle().checked).toBe(false)

    fireEvent.click(muteToggle())
    expect(data().bgm).toEqual({ ref: 'a-aud-battle', volume: 0 })
    expect(muteToggle().checked).toBe(true)
    expect(queryVolumeSlider()).toBeNull()

    fireEvent.click(muteToggle())
    expect(data().bgm).toEqual({ ref: 'a-aud-battle', volume: 1 })
    expect(volumeSlider().value).toBe('1')
  })

  it('未选曲目也能单独调音量（volume-only 配置）', () => {
    const data = renderControlled(graphWith({ name: 'A' }))
    expect(volumeSlider().disabled).toBe(false)
    fireEvent.change(volumeSlider(), { target: { value: '0.35' } })
    expect(data().bgm).toEqual({ volume: 0.35 })

    fireEvent.click(muteToggle())
    expect(data().bgm).toEqual({ volume: 0 })
  })

  it('结束当前音乐时不显示音量配置', () => {
    renderPanel(graphWith({ name: 'A', bgm: { mode: 'stop' } }))
    expect(screen.queryByRole('slider', { name: /音量/ })).toBeNull()
  })

  it('空态选「结束当前音乐」→ 落 { mode: "stop" }（不需要 ref）', () => {
    const onChange = renderPanel(graphWith({ name: 'A' }))
    fireEvent.change(modeSelect(), { target: { value: 'stop' } })
    expect(lastData(onChange).bgm).toEqual({ mode: 'stop' })
  })

  it('stop 那一条不带曲子：资产下拉与重进选项一起收起', () => {
    renderPanel(graphWith({ name: 'A', bgm: { mode: 'stop' } }))
    expect(modeSelect().value).toBe('stop')
    expect(screen.queryByTitle(/与资产库音频一致/)).toBeNull()
    expect(queryCheckbox(/从头重播/)).toBeNull()
  })

  // 面板不能落一份自相矛盾的配置：`{ mode: 'stop', ref: 'x' }` 的 ref 被 runtime 整条忽略
  // （applyNodeBgm 的 stop 分支不读它），留着它就是「显示着一首永远不播的曲子」。
  it('曲子 → stop：不留下 ref / restart 残留', () => {
    const onChange = renderPanel(graphWith({
      name: 'A',
      bgm: { ref: 'a-aud-battle', restart: true },
    }))
    fireEvent.change(modeSelect(), { target: { value: 'stop' } })
    expect(lastData(onChange).bgm).toEqual({ mode: 'stop' })
  })

  it('restart 勾选来回都写得出（默认 false 不落盘）', () => {
    const onChange = renderPanel(graphWith({ name: 'A', bgm: { ref: 'a-aud-battle' } }))
    fireEvent.click(checkbox(/从头重播/))
    expect(lastData(onChange).bgm).toEqual({ ref: 'a-aud-battle', restart: true })

    cleanup()
    const onChange2 = renderPanel(graphWith({ name: 'A', bgm: { ref: 'a-aud-battle', restart: true } }))
    expect((checkbox(/从头重播/) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(checkbox(/从头重播/))
    expect(lastData(onChange2).bgm).toEqual({ ref: 'a-aud-battle' })
  })

  it('选「（空）」→ data 上不再有 bgm 键（而不是留下空 ref）', () => {
    const onChange = renderPanel(graphWith({ name: 'A', bgm: { ref: 'a-aud-battle', restart: true } }))
    fireEvent.change(audioSelect(), { target: { value: '' } })
    expect('bgm' in lastData(onChange)).toBe(false)
  })

  it('mode / restart 的默认值不落盘（「没配」与「配了默认值」在磁盘上同形）', () => {
    const onChange = renderPanel(graphWith({ name: 'A', bgm: { ref: 'a-aud-battle', mode: 'replace', restart: true } }))
    fireEvent.change(modeSelect(), { target: { value: 'push' } })
    expect(lastData(onChange).bgm).toEqual({ ref: 'a-aud-battle', restart: true })

    fireEvent.click(checkbox(/从头重播/))
    expect(lastData(onChange).bgm).toEqual({ ref: 'a-aud-battle', mode: 'replace' })
  })

  // 空态下先选动作、再选曲子是最自然的顺序，但 `patchNodeBgm` 对「没有 ref 且不是 stop」的
  // 配置一律删键，于是这一步落不了盘——没有本地草稿的话，下拉会当场弹回「起播并记住上一首」，
  // 看起来像点了没反应。用受控宿主才复现得出来（静态 parent 里 props 不回灌，看不出弹回）。
  it('还没选曲子时也能切到「换曲」，且选了曲子后 mode 跟着落盘', () => {
    const data = renderControlled(graphWith({ name: 'A' }))
    fireEvent.change(modeSelect(), { target: { value: 'replace' } })
    expect(modeSelect().value).toBe('replace')
    expect('bgm' in data()).toBe(false) // 还没曲子 → 不落盘（不留 { ref: '' } 残留）

    fireEvent.change(audioSelect(), { target: { value: 'a-aud-boss' } })
    expect(data().bgm).toEqual({ ref: 'a-aud-boss', mode: 'replace' })
    expect(modeSelect().value).toBe('replace')
  })

  it('换到另一个节点时动作草稿复位，不跟着串台', () => {
    const graph: GameGraph = {
      nodes: [node('n1', { name: 'A' }), node('n2', { name: 'B' })],
      edges: [],
    }
    const { rerender } = render(<NodeInspector graph={graph} nodeId="n1" audioOptions={LIB} onChange={vi.fn()} />)
    fireEvent.change(modeSelect(), { target: { value: 'replace' } })
    expect(modeSelect().value).toBe('replace')
    rerender(<NodeInspector graph={graph} nodeId="n2" audioOptions={LIB} onChange={vi.fn()} />)
    expect(modeSelect().value).toBe('push')
  })

  // 2026-07-27 起面板上不再铺开解释性文案（产品决策：只留表单），三条动作的语义全压在
  // 「播放动作」下拉的 tooltip 里。下面几条钉的是**说法本身**没随着搬家而失真——尤其
  // v2 的核心反转（D5）：离开节点不再是结束信号。旧说法（「走边离开立刻恢复上一首」）是最
  // 误导的一种错——作者照它写，配了 BGM 的曲子会一路跟到结局，而他以为自己不用管。
  it('动作说明讲「一直播」，不承诺「离开就恢复」', () => {
    renderPanel(graphWith({ name: 'A', bgm: { ref: 'a-aud-battle' } }))
    const t = modeSelect().title
    expect(t).toMatch(/配了就一直播/)
    expect(t).toMatch(/走边离开本节点、弹回外层子流程\/子蓝图都不结束/)
    expect(t).not.toMatch(/立刻恢复上一首/)
  })

  // D11：BGM 配置不得反过来要求作者改蓝图结构。「用上面的『嵌套』把它们包成容器」这类引导
  // 被这条决策否掉（跨节点共用一首靠默认粘住就够了），面板任何角落都不该再出现。
  it('不引导「包成容器」', () => {
    renderPanel(graphWith({ name: 'A', bgm: { ref: 'a-aud-battle' } }))
    expect(screen.queryByText(/用上面的「嵌套」|把它们包成容器|包进容器/)).toBeNull()
    expect(modeSelect().title).not.toMatch(/包成容器|包进容器/)
  })

  // 三条动作各自的落点，逐句对着 bgm-stack.ts：replace 不记住被顶掉的那首（结束这层回到的是
  // 它**下面**那层）；stop 弹不掉文档床（栈顶是 '__doc__' 时返回 null = 一条指令都不发），
  // 否则「多写一个 stop」会让整局哑掉。
  it('动作说明覆盖 push / replace / stop 三条落点', () => {
    renderPanel(graphWith({ name: 'A', bgm: { ref: 'a-aud-battle' } }))
    const t = modeSelect().title
    expect(t).toMatch(/起播并记住上一首 = 这层被结束时回到它/)
    expect(t).toMatch(/换曲不记住 = 顶掉正在响的那首、层数不变/)
    expect(t).toMatch(/文档默认床轨时例外/)
    expect(t).toMatch(/结束当前音乐 = 结束正在响的这层，回到上一层还没结束的那首/)
    expect(t).toMatch(/只剩文档床时什么都不做/)
  })

  // 只留表单：段首说明、每条动作的说明、空候选提示都不再铺在面板上。
  it('面板上不再铺解释性文案', () => {
    renderPanel(graphWith({ name: 'A', bgm: { ref: 'a-aud-battle' } }))
    expect(screen.queryByText(/配了就一直播/)).toBeNull()
    expect(screen.queryByText(/起播并记住此刻正响的那首/)).toBeNull()
    expect(screen.queryByText(/素材库暂无音频资产|直接填 id/)).toBeNull()
  })

  // 2026-07-27 去掉「到本子流程/子蓝图结束为止」勾选之后（产品决策）：弹 callStack 帧、局内清空
  // callStack 都不动 BGM 栈（engine 的 advanceAuto / consumeRedirect），所以面板既不能再提供那个
  // 勾选，也得明说「出了容器也不结束」——否则作者会替引擎脑补一条不存在的自动结束。
  it('不再有作用域勾选，普通节点与容器节点都一样', () => {
    renderPanel(graphWith({ name: 'A', bgm: { ref: 'a-aud-battle' } }))
    expect(queryCheckbox(/到本子流程/)).toBeNull()
    cleanup()
    renderPanel(graphWith({ name: 'A', subFlowPack: { id: 'bp-combat' }, bgm: { ref: 'a-aud-battle' } } as never))
    expect(queryCheckbox(/到本子流程/)).toBeNull()
    expect(screen.queryByText(/整个子流程\/子蓝图期间/)).toBeNull()
  })

  it('动作说明把 stop 说成唯一的局内出口', () => {
    renderPanel(graphWith({ name: 'A', bgm: { ref: 'a-aud-battle' } }))
    expect(modeSelect().title).toMatch(/只有在该停的节点上选「结束当前音乐」，或跳转 \/ 重开一局才会退掉它/)
  })

  // 与「视频」字段同款：不在素材候选里的当前 ref 显示为禁用的「不在素材库」，不进可选项。
  it('当前 ref 不在素材候选里时显示禁用「不在素材库」，候选不含该 id 明文', () => {
    const { container } = render(
      <NodeInspector
        graph={graphWith({ name: 'A', bgm: { ref: 'bgm-battle' } })}
        nodeId="n1"
        audioOptions={[{ id: 'a-aud-1', label: '战斗床 (a-aud-1)' }]}
        onChange={vi.fn()}
      />,
    )
    const selector = container.querySelector<HTMLSelectElement>('select[title*="与资产库音频一致"]')
    expect(selector).toBeTruthy()
    expect([...selector!.options].map((option) => [option.value, option.text]))
      .toEqual([
        ['__unavailable__', '（当前音乐不在素材库）'],
        ['', '（空）'],
        ['a-aud-1', '战斗床'],
      ])
    expect(selector!.value).toBe('__unavailable__')
    expect(selector!.textContent).not.toContain('bgm-battle')
  })

  // 容器在 v2 里不是作用域（D11）：容器 BGM 与普通节点同寿命，说明也是同一份，
  // 「弹回外层才恢复」这句话对它一样是错的。
  it('容器节点的动作说明与普通节点同一份，不承诺弹回外层就恢复', () => {
    renderPanel(graphWith({
      name: 'A',
      subFlowPack: { id: 'bp-combat' },
      bgm: { ref: 'a-aud-boss', mode: 'replace' },
    } as never))
    expect(modeSelect().title).not.toMatch(/弹回外层才恢复|整个子流程\/子蓝图期间/)
    expect(modeSelect().title).toMatch(/换曲不记住/)
  })
})
