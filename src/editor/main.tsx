// 必须最先求值：把历史 localStorage 键迁移到 game-video 命名空间，
// 早于任何 store 在模块求值期的 hydrate。详见该模块头注。
import './bootMigrateLegacyKeys'
import { createRoot } from 'react-dom/client'
import { initLocaleSync } from '../i18n'
import { GraphApp } from './GraphApp'
import { PlayerBootstrap } from './bootstrap/PlayerBootstrap'
import { ErrorToastHost, RenderErrorBoundary } from './diagnostics'
import { registerEditorDiagnosticContext } from './diagnostics/editor-context'
import './styles/global.css'

initLocaleSync()

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

// The iframe entry owns this document; in-process mount() deliberately does
// not apply these document-level styles to its host.
document.documentElement.classList.add('ks-app-standalone')
document.body.classList.add('ks-app-standalone')
root.classList.add('ks-app-host')

// 表面路由：
//   默认             → GraphApp（正式编辑器）
//   ?surface=player  → 先握手并读取宿主绑定 package，再运行真实游戏文档
// player 不套 StrictMode，避免 start() 被双调用重复推进。
const surface = new URLSearchParams(location.search).get('surface')
const content = surface === 'player'
  ? (
      <div style={{ position: 'fixed', inset: 0 }}>
        <PlayerBootstrap />
      </div>
    )
  : <GraphApp />

registerEditorDiagnosticContext()

createRoot(root).render(
  <>
    <RenderErrorBoundary
      region={surface === 'player' ? 'player-root' : 'editor-root'}
      variant="root"
      onReload={() => window.location.reload()}
    >
      {content}
    </RenderErrorBoundary>
    <RenderErrorBoundary region="diagnostics-toast" variant="silent">
      <ErrorToastHost />
    </RenderErrorBoundary>
  </>,
)
