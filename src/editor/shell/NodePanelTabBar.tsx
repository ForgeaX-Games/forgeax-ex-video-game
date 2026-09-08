import { t as translateUi } from '../../i18n'
import type { CSSProperties } from 'react'

/** 节点面板一级页签 id：`agent` 为预留空态，`config` 承载整个节点配置面板。 */
export type NodePanelTab = 'agent' | 'config'

/** 一级页签样式（Figma 14597:21458）：栏高固定 58px、字号 16px；选中白字 + 品牌橙 4px 下划线，
 *  未选中白 40%。下划线用 inset box-shadow 绘制，不占布局高度，两态文字基线天然对齐。
 *  borderRadius/padding 显式归零：global.css 的 button 重置带圆角与 6px 12px 内边距，
 *  圆角会让 inset 下划线两端呈圆弧、内边距会把下划线撑得比文字宽。 */
function panelTabStyle(active: boolean): CSSProperties {
  return {
    height: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    borderRadius: 0,
    padding: 0,
    boxShadow: active ? 'inset 0 -4px 0 0 #FF9C2A' : 'none',
    color: active ? '#FFFFFF' : 'rgba(255,255,255,0.4)',
    fontSize: 16,
    fontWeight: 500,
    lineHeight: 1.5,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    flexShrink: 0,
  }
}

/**
 * 节点配置面板右列头部的一级页签栏（Figma 14597:21458）：Agent（预留空态）｜{节点名}调试面板，
 * ✕ 关闭右置。栏高 58px、底部分隔线 white 20%；作为列头不随内容滚动。
 */
export function NodePanelTabBar({
  activeTab,
  configLabel,
  onTabChange,
  onClose,
}: {
  activeTab: NodePanelTab
  /** 配置页签文案（{节点名}调试面板）；超长时按 maxWidth 省略，完整文案进 title。 */
  configLabel: string
  onTabChange: (tab: NodePanelTab) => void
  onClose: () => void
}): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={translateUi('ui.copy.38117c3cf317')}
      style={{
        display: 'flex',
        gap: 16,
        alignItems: 'stretch',
        height: 58,
        background: '#2C2C2C',
        borderBottom: '1px solid rgba(255,255,255,0.2)',
        flexShrink: 0,
      }}
    >
      <button
        role="tab"
        aria-selected={activeTab === 'agent'}
        onClick={() => onTabChange('agent')}
        style={{ ...panelTabStyle(activeTab === 'agent'), minWidth: 83 }}
      >
        {translateUi('ui.copy.5ce2e6f40299')}</button>
      <button
        role="tab"
        aria-selected={activeTab === 'config'}
        onClick={() => onTabChange('config')}
        title={configLabel}
        style={{
          ...panelTabStyle(activeTab === 'config'),
          maxWidth: '60%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {configLabel}
      </button>
      <button
        onClick={onClose}
        title={translateUi('ui.copy.6c14bd7f6f9e')}
        style={{ marginLeft: 'auto', alignSelf: 'center', marginRight: 10, color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}
      >
        ✕
      </button>
    </div>
  )
}
