/**
 * 文字叠加（TextOverlayClip）可选字体预设。
 *
 * key 存进 clip.fontFamily；渲染时映射到 cssFamily。挑了一组在 Chromium
 * (Electron/Cursor) 下大概率可用的中英字体族，并都带兜底，缺字时不至于乱码。
 */
export interface FontPreset {
  key: string
  label: string
  cssFamily: string
}

export const FONT_PRESETS: FontPreset[] = [
  { key: 'sans', label: '黑体 / 无衬线', cssFamily: '"PingFang SC", "Microsoft YaHei", "Heiti SC", system-ui, sans-serif' },
  { key: 'serif', label: '宋体 / 衬线', cssFamily: '"Songti SC", "SimSun", Georgia, "Times New Roman", serif' },
  { key: 'kai', label: '楷体', cssFamily: '"Kaiti SC", "STKaiti", KaiTi, serif' },
  { key: 'rounded', label: '圆体', cssFamily: '"Yuanti SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif' },
  { key: 'mono', label: '等宽', cssFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace' },
  { key: 'impact', label: '标题 / 粗黑', cssFamily: 'Impact, "Haettenschweiler", "PingFang SC", system-ui, sans-serif' },
]

const DEFAULT_FAMILY = FONT_PRESETS[0]!.cssFamily

/** 解析 clip.fontFamily（preset key 或自定义 css family）为可用的 css font-family。 */
export function resolveFontFamily(fontFamily: string | undefined): string {
  if (!fontFamily) return DEFAULT_FAMILY
  const preset = FONT_PRESETS.find((p) => p.key === fontFamily)
  return preset ? preset.cssFamily : fontFamily
}
