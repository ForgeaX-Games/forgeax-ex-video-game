/**
 * editor boot —— 填充**默认**组件/Skin 表（画布/校验用）。
 * 多局试玩各自用 GraphSession 内的隔离表，不依赖本函数。
 *
 * 字体已下沉到 component-host 层自带（皮肤组件自调 `ensureBrushFont()`），
 * 这里不再注入字体——boot 只负责拉起 `bootComponents`。
 */
import { bootComponents } from '@/runtime/react/component-host'

/**
 * 幂等：经 `bootComponents` 注册平台内建组件集。
 * Studio / Player / PlaySurface 入口调用；传入 `slug` 时顺带加载游戏专属组件。
 */
export function bootEditorSkins(slug?: string): void {
  void bootComponents(slug)
}
