/**
 * gameScope —— 把"当前 game（工程）"绑定到视频游戏工坊的剧本库。
 *
 * 背景（2026-06 根因修复）：
 *   reel 作为 iframe 被主界面挂载，主界面已经把当前 game 的 slug 通过
 *   `?slug=<slug>` 喂进 iframe URL（见 interface 的 StandalonePluginIframe
 *   .buildIframeSrc）。但 reel 一直忽略它，于是无论用户在顶栏切到哪个
 *   game，视频游戏工坊永远读的是那份**全局** `.reel-scenarios` 库（activeId 停在
 *   上一次的剧本），新建 game / 新会话里生成的剧情也进不来。
 *
 * 这个模块把 slug 读出来，让剧本库（localStorage + 磁盘镜像 + forge-queue）
 * 按 game 隔离：
 *   - 有 slug：库走 `<root>/.forgeax/games/<slug>/reel/`，每个 game 一套独立
 *     剧本与 activeId；新建 game = 空白影游。
 *   - 无 slug：行为与历史完全一致（全局 `.reel-scenarios`），老剧本零改动。
 *
 * iframe 在 slug 变化时会整体重载（host 侧 src 变 → iframe reload），所以这里
 * 把 slug 缓存为模块级常量即可，一次 page-load 内不变。
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

let _cached: string | null | undefined
/**
 * 宿主进程内挂载（`mount()` / `applyHostInit({ slug })`）时 game 走 props 注入，
 * URL 上没有 slug。它优先于 URL：URL 只是 iframe 形态的来源。
 */
let _hostSlug: string | null = null

/** 由 `applyHostInit` 调用；进程内挂载的 game 标识归口。 */
export function setHostGameSlug(slug: string | null | undefined): void {
  _hostSlug = slug?.trim() || null
}

/**
 * 跨 tab 同步频道的作用域 id —— 权威来源是 boot 后拿到的真实 game（center 走
 * 宿主握手的 `context.gameId`，left 走 `ensureBoot`）。它只影响 BroadcastChannel /
 * storage 键的 game 后缀，**不影响** `getGameSlug()`（磁盘/接口 `?game=` 仍按 slug）。
 * 未设置时 `gameKeySuffix()` 回落到 URL slug，保持历史行为。
 */
let _syncGameId: string | null = null

/** 由 `GraphApp` 在拿到真实 game 后调用，作为同步频道命名的权威 id。 */
export function setSyncGameId(id: string | null | undefined): void {
  _syncGameId = id?.trim() || null
}

function readGameSlug(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const p = new URLSearchParams(window.location.search)
    // 主界面用 `slug=`；保留 `game=` 作为别名，便于直接拼 URL 调试。
    const raw = (p.get('slug') ?? p.get('game') ?? '').trim()
    return raw && SLUG_RE.test(raw) ? raw : null
  } catch {
    return null
  }
}

/** 当前 game slug；无（全局库）时为 null。URL 结果缓存（iframe 重载才会变）。 */
export function getGameSlug(): string | null {
  if (_hostSlug) return _hostSlug
  if (_cached !== undefined) return _cached
  _cached = readGameSlug()
  return _cached
}

/**
 * 磁盘/forge-queue 端点的 `?game=<slug>` 查询后缀。
 * 全局库（无 slug）时返回空串，端点行为与历史一致。
 * @param prefix 当 URL 已带 query 时传 '&'，否则默认 '?'。
 */
export function gameQuery(prefix: '?' | '&' = '?'): string {
  const slug = getGameSlug()
  return slug ? `${prefix}game=${encodeURIComponent(slug)}` : ''
}

/**
 * 跨 tab 同步频道 / storage 键的 per-game 后缀（全局库时为空串）。
 * 优先用 `setSyncGameId` 注入的权威 game（boot 后的真实 id），回落到 URL slug。
 */
export function gameKeySuffix(): string {
  const id = _syncGameId ?? getGameSlug()
  return id ? `:game:${id}` : ''
}

/** 仅测试用：清缓存让下次重新读 URL。 */
export function __resetGameScopeForTest(): void {
  _cached = undefined
  _hostSlug = null
  _syncGameId = null
}
