import { t as translateUi } from '../../../i18n'
/**
 * BGM 分区 —— 本节点作为 owner 的床轨。视觉取自 Figma 15635:82373（填充态），
 * 控件写图的入口与换皮前完全一致。
 */
import type { NodeBgm } from '@/runtime/core/schema/graph-schema'
import { authoringOptionLabel } from '@/authoring/formulas/authoring-option-label'
import type { NodeDataPatch } from '@/authoring/graph/graph-edit'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { patchNodeBgm, type AudioOption } from '@/authoring/audio/bgm-authoring'
import { NiField, NiIcon, NiSection, NiSelect, NiSlider } from '../ni-ui'

/**
 * 「播放动作」下拉的 hover 说明 —— 面板上不再铺开这些解释（只留表单本身），所以三条动作的
 * 语义全压在这一条 tooltip 里。逐句对着 `bgm-stack.ts` 核过：
 * - push：`apply` 压新帧，旧帧留在下面，等这层被结束时 `resume` 回到它；
 * - replace：只换栈顶帧的播放字段，被顶掉的那首**没有**留在栈上（栈空、或栈顶是弹不掉的
 *   文档床时退化成 push）；
 * - stop：`stop()` 结束栈顶那层、回到下一层，栈顶已是文档床时返回 null（一条指令都不发，D13）。
 *
 * 「离开本节点不结束」必须说：调度层弹 `callStack` 帧、局内清空 `callStack` 都**不动** BGM 栈
 * （见 `engine.ts` 的 `advanceAuto` / `consumeRedirect`），「包进子流程就会自己收掉」是作者最
 * 容易替引擎脑补出来的一条不存在的规则。
 */
const BGM_MODE_TITLE = '留空 = 这里不换音乐，继续播上层正在响的那首。配了就一直播：走边离开本节点、弹回外层子流程/子蓝图都不结束，只有在该停的节点上选「结束当前音乐」，或跳转 / 重开一局才会退掉它。\n起播并记住上一首 = 这层被结束时回到它；换曲不记住 = 顶掉正在响的那首、层数不变（正响的是文档默认床轨时例外：它是地板顶不掉，会另起一层）；结束当前音乐 = 结束正在响的这层，回到上一层还没结束的那首（只剩文档床时什么都不做）。'

const BGM_TRACK_TITLE = '选择该节点作用域 BGM（与资产库音频一致，仅显示 Kino 接口资源）；空 = 不换曲，沿用上层正在播的那首'

const BGM_RESTART_TITLE = '不勾 = 同一首接着播（战斗多回合靠它不断曲）；勾上 = 每次重新进入本节点都从头播。'

/**
 * 稿子只画了「BGM选择 / 播放方式 / 音量」，音量是**标签与轨道同一行**（15635:82412）。
 * 交互改成「BGM声音」+ 静音图标：静音（volume=0）藏滑杆，非静音才出调节条。
 */
const BGM_CSS = `
.ni-root .ni-bgm-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.ni-root .ni-bgm-row-label {
  flex: none;
  font-size: var(--ni-fs-meta);
  color: var(--ni-w-60);
}
/* 数值气泡浮在轨道上方，稿子在音量行之上专门留了一行空位（15635:82405）。 */
.ni-root .ni-bgm-volume-row { margin-top: 12px; }
.ni-root .ni-bgm-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  color: var(--ni-w-60);
}
.ni-root .ni-bgm-mute {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ni-w-60);
  cursor: pointer;
}
.ni-root .ni-bgm-mute:hover { color: var(--ni-w-100); background: var(--ni-w-10); }
.ni-root .ni-bgm-mute.is-muted { color: var(--ni-accent); }
.ni-root .ni-bgm-mute-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
  width: 0;
  height: 0;
}
`

export function BgmSection({
  bgm,
  bgmMode,
  selectedAudioValue,
  audioOptions,
  setDraftBgmMode,
  patchData,
}: {
  bgm: NodeBgm | undefined
  bgmMode: 'push' | 'replace' | 'stop'
  selectedAudioValue: string
  audioOptions: AudioOption[]
  setDraftBgmMode: (mode: 'push' | 'replace') => void
  patchData: (p: NodeDataPatch) => void
}): JSX.Element {
  injectStyleOnce('ni-bgm', BGM_CSS)
  // 静音 = 显式 volume: 0；未写 volume 视为有声（展示 100%，拖动后再落盘）。
  const muted = bgm?.volume === 0
  const volume = typeof bgm?.volume === 'number' && bgm.volume > 0 ? bgm.volume : 1
  return (
    /* 作用域 BGM：本节点作为 owner 的床轨。不填 = 不动 BGM 栈（继续播上层那首），旧图零行为变化。 */
    <NiSection title={translateUi('ui.copy.a7eb32ca0ea2')}>
      {/* 「播放动作」在空态也得在：`{ mode: 'stop' }` 是一条没有 ref 的配置，藏到「填了 ref 之后」
          作者就永远选不到它（v2 里 win / lose 全靠这条收尾）。 */}
      <NiField label={translateUi('ui.copy.c3428184e9c4')}>
        <NiSelect
          value={bgmMode}
          title={BGM_MODE_TITLE}
          options={[
            { value: 'push', label: translateUi('ui.object.7f5108806d8c') },
            { value: 'replace', label: translateUi('ui.object.28138c0f9936') },
            { value: 'stop', label: translateUi('ui.object.59e39cfe760f') },
          ]}
          onChange={(value) => {
            const mode = value as 'push' | 'replace' | 'stop'
            // stop 自己就是一条完整配置（不带曲子），落得了盘；push / replace 在空态落不了，
            // 记进草稿让下拉停在作者选的那一项上。
            if (mode !== 'stop') setDraftBgmMode(mode)
            patchData({ bgm: patchNodeBgm(bgm, { mode }) })
          }}
        />
      </NiField>
      {/* stop 那一条不引入曲子（SPEC §7）：资产输入收起，连带 restart 一起——
          它在 stop 上没有落点（patchNodeBgm 也会把它收掉）。 */}
      {bgmMode === 'stop' ? null : (
        <>
          <NiField label={translateUi('ui.copy.f0ccc60a0f8d')}>
            <NiSelect
              value={selectedAudioValue}
              title={BGM_TRACK_TITLE}
              onChange={(value) => patchData({ bgm: patchNodeBgm(bgm, { ref: value, mode: bgmMode }) })}
            >
              {selectedAudioValue === '__unavailable__' ? (
                <option value="__unavailable__" disabled>{translateUi('ui.copy.93d435c50607')}</option>
              ) : null}
              <option value="">{translateUi('ui.copy.c6db27374652')}</option>
              {audioOptions.map((option) => (
                <option key={option.id} value={option.id}>{authoringOptionLabel(option.label, option.id)}</option>
              ))}
            </NiSelect>
          </NiField>
          <div className="ni-bgm-row ni-bgm-volume-row">
            <span className="ni-bgm-row-label">{translateUi('ui.copy.2891bb99cde5')}</span>
            <label
              className={muted ? 'ni-bgm-mute is-muted' : 'ni-bgm-mute'}
              title={muted ? translateUi('ui.copy.59bc75cad0d0') : translateUi('ui.copy.afdbd1ddecd8')}
            >
              <input
                type="checkbox"
                className="ni-bgm-mute-input"
                aria-label={translateUi('ui.copy.afdbd1ddecd8')}
                checked={muted}
                onChange={(e) => patchData({
                  bgm: patchNodeBgm(bgm, { volume: e.target.checked ? 0 : 1 }),
                })}
              />
              <NiIcon name={muted ? 'mute' : 'volume'} size={14} />
            </label>
            {/* `ni-bgm-volume` 是旧全局规则与面板测试认的钩子，随 className 一起带给 NiSlider。 */}
            {muted ? null : (
              <NiSlider
                ariaLabel="BGM 音量"
                className="ni-bgm-volume"
                value={volume}
                bubble={`${Math.round(volume * 100)}%`}
                onChange={(next) => patchData({ bgm: patchNodeBgm(bgm, { volume: next }) })}
              />
            )}
          </div>
          {bgm?.ref ? (
            <>
              <NiField label={translateUi('ui.copy.22b868299d53')}>
                <NiSelect
                  ariaLabel="BGM 播放模式"
                  value={bgm.loop === false ? 'once' : 'loop'}
                  options={[
                    { value: 'loop', label: translateUi('ui.object.ad3221dd6681') },
                    { value: 'once', label: translateUi('ui.object.3de42d7c68d4') },
                  ]}
                  onChange={(value) => patchData({ bgm: patchNodeBgm(bgm, { loop: value === 'loop' ? undefined : false }) })}
                />
              </NiField>
              <label className="ni-bgm-row">
                <span className="ni-bgm-row-label">{translateUi('ui.copy.313bfab37a74')}</span>
                <span className="ni-bgm-check" title={BGM_RESTART_TITLE}>
                  <input
                    type="checkbox"
                    checked={bgm.restart === true}
                    onChange={(e) => patchData({ bgm: patchNodeBgm(bgm, { restart: e.target.checked }) })}
                  />
                  {translateUi('ui.copy.ba47d71e75cf')}</span>
              </label>
            </>
          ) : null}
        </>
      )}
    </NiSection>
  )
}
