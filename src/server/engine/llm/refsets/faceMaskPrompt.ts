/**
 * 人脸局部马赛克提示词 —— **已废弃（v7 / 2026-06）**。
 *
 * 历史：
 *   旧版在「生成提示词」里强制给写实真人脸画上像素马赛克（角色三视图的
 *   faceMaskClause、分镜关键帧的 shotFaceMaskClause），以求下游图生视频模型
 *   （Seedance/Kling）不被「完整真人脸」触发 `safety_violations=[person]`。
 *
 * 现状（作者要求）：
 *   · 对作者**展示干净的写实真人图**（截图样式），生成期不再打码。
 *   · 人脸打码迁移到「上传给 Seedance 之前」的 {@link ../faceMaskTool}，
 *     只有图片真正塞进视频请求时才走一遍打码工具。
 *
 * 这两个函数因此**恒返回空串**（保留签名与调用点，避免牵动 forgeImagePipeline /
 * batchImageGen 的调用方与 re-export）。如需恢复生成期打码，改这里即可。
 *
 * @deprecated 打码已迁移到 faceMaskTool（上传期）。本模块仅作兼容占位。
 */

import type { VisualStyle } from '../../scenario/types'

/**
 * @deprecated 恒返回空串。打码已迁移到 faceMaskTool（上传给 Seedance 前）。
 */
export function faceMaskClause(
  _intensity: 'none' | 'subtle' | 'full',
  _visualStyle?: VisualStyle,
): string {
  return ''
}

/**
 * @deprecated 恒返回空串。打码已迁移到 faceMaskTool（上传给 Seedance 前）。
 */
export function shotFaceMaskClause(
  _visualStyle: VisualStyle | undefined,
  _charCount: number,
): string {
  return ''
}
