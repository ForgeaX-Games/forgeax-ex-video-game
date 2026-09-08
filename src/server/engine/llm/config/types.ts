/**
 * Provider 共用契约 —— 抽象掉具体厂商，便于换/降级。
 */

/**
 * 用户消息里的图片输入（多模态）—— Phase 5（P4 路径）新增。
 *
 * 用例：让 LLM "读图"——比如作者贴一张概念图，让 Claude Opus 描述场景、揣测剧情、
 * 生成 story seed。
 *
 * 编码：必须是 data URL 形式（`data:<mime>;base64,<...>`），provider 层负责
 * 拆 mime 与 base64 喂给具体厂商 API。
 *
 * 兼容：老调用点（不传 images）零改动；只有新调用点才会传非空数组。
 * provider 实现层若不支持图片输入，应在 generate() 入口检查并抛
 * `[MULTIMODAL_NOT_SUPPORTED]` 错，由调用方决定是否退路径。
 */
export interface TextImageInput {
  /** 图片的 data URL，必须 base64 编码。例 `data:image/png;base64,iVBORw0KG...` */
  dataUrl: string
  /**
   * 人类可读标签（如 "概念图 #1"），便于 prompt 文字层引用 + debug。
   * 不会单独发到 LLM；如果你想让 LLM 引用某张图，请在 userPrompt 里自己描述。
   */
  label?: string
}

export interface TextRequest {
  systemPrompt: string
  userPrompt: string
  /**
   * 多模态：附带的图片输入。Phase 5 新增，老调用点可省略。
   * - 留空 / 不传 → 走纯文本路径（与原行为一致）
   * - 非空 → provider 必须把图片以厂商 API 规定方式拼进 user message
   *
   * provider 实现规约（约束接收方）：
   *   - ClaudeAzureProvider：拼 image content block 到 messages[0].content[]
   *   - GeminiProvider / Mock：当前不支持，应抛 `[MULTIMODAL_NOT_SUPPORTED]`
   */
  images?: TextImageInput[]
  temperature?: number
  maxTokens?: number
  /** 强制 JSON 输出（true 时模型会被指示返回单一 JSON 对象） */
  jsonMode?: boolean
}

/**
 * 流式事件 —— 让 UI 看见 LLM 正在做什么：
 *
 *   - `open`        : 连接已建立（ttfb 计时点）
 *   - `text`        : 模型吐了一段文本 delta（SSE content_block_delta.text_delta）
 *   - `done`        : 流结束，full 是所有 text delta 拼起来
 *   - `error`       : 任何错误；此后不会再有事件
 *
 * 不暴露 SSE 的底层事件类型（message_start 等），UI 不该关心厂商协议。
 */
export type StreamEvent =
  | { type: 'open' }
  | { type: 'text'; delta: string; cumulative: string }
  | { type: 'done'; full: string; stopReason?: string; latencyMs: number }
  | { type: 'error'; message: string }

export interface TextClient {
  /** 一次性返回（非流式）；前端编辑器场景下足够用 */
  generate(req: TextRequest): Promise<string>
  /**
   * 流式生成 —— 每一段 delta 通过 onEvent 回调。可选实现；没实现的 provider
   * 会被 promptForge 的调用点 fallback 到 `generate()` + 合成一次 done 事件。
   */
  generateStream?: (
    req: TextRequest,
    onEvent: (ev: StreamEvent) => void,
    signal?: AbortSignal,
  ) => Promise<string>
  /** 健康探针 */
  ping(): Promise<{ ok: boolean; latencyMs: number; sample?: string; error?: string }>
  getModel(): string
  getProviderName(): string
}

/**
 * 便捷 helper：不管 provider 是否实现 generateStream，都能用上一套接口。
 * 没实现的话就 fallback 到 generate()，然后合成 open / text(full) / done 三个事件。
 */
export async function streamOrFallback(
  llm: TextClient,
  req: TextRequest,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (typeof llm.generateStream === 'function') {
    return llm.generateStream(req, onEvent, signal)
  }
  onEvent({ type: 'open' })
  const t0 =
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
  const full = await llm.generate(req)
  onEvent({ type: 'text', delta: full, cumulative: full })
  const t1 =
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
  onEvent({ type: 'done', full, latencyMs: Math.round(t1 - t0) })
  return full
}

/**
 * 一张参考图 —— 给 Phase B 的"带参考图生图"路径用。
 * 标签用于 prompt 文字层引用（"image #0 = location; #1-2 = characters"）。
 */
export interface ImageReference {
  /** 参考图的 data URL（`data:image/png;base64,...` 或 `/__reel__/assets/xxx`） */
  dataUrl: string
  /** 参考图的语义角色，用于 prompt 文字层说明；也便于未来 UI 展示 */
  role?: 'location' | 'character' | 'prop' | 'composition'
  /** 人类可读标签（如 "林深 · 三视图"），便于 debug 和 UI */
  label?: string
}

export interface ImageRequest {
  prompt: string
  size?: '1024x1024' | '1024x1536' | '1536x1024'
  n?: number
  /**
   * 透传给底层模型，作为单张参考图（v3.7 以前的单图路径）。
   * @deprecated 2026-05 · 改用 `referenceImages`；此字段仍保留给老调用点，
   *   provider 层会把它合并进 referenceImages[0]。
   */
  referenceImageDataUrl?: string
  /**
   * v3.8 · 多参考图（Phase B）。
   *
   * provider 层规则：
   *   - 传空数组或省略 → 走纯文生图端点（/images/generations）
   *   - 非空 → 走图生图端点（/images/edits），用 multipart 上传
   *   - Azure gpt-image-2 上限 16 张；调用方应自行 slice，不要依赖 provider 裁剪
   *
   * 未来若有 provider 支持更多维度（mask / 权重），扩展此类型即可。
   */
  referenceImages?: ImageReference[]
  /**
   * 背景控制（v9 · UI 素材库）。
   *   - 'transparent'：请求原生透明底(仅 gpt-image-1.x 支持;gpt-image-2 会 400,
   *     provider 层有能力守卫会自动丢弃回落到不透明)。
   *   - 'opaque'/'auto'：透传给模型(多数场景不需要)。
   * 缺省 = 不发该字段(模型默认)。
   */
  background?: 'transparent' | 'opaque' | 'auto'
  /**
   * 输出格式（v9）。透明底必须 png/webp;jpeg 无 alpha。缺省 = 不发(png)。
   */
  outputFormat?: 'png' | 'jpeg' | 'webp'
  /**
   * 生成质量（v9）。gpt-image-2 必带 quality;缺省由 provider 兜底 'medium'。
   * UI 素材(线条/发光)建议 'high' 以保边缘锐利。
   */
  quality?: 'low' | 'medium' | 'high'
}

export interface ImageResult {
  /** 直接给 <img src=...> 用的 data URL（base64 inline） */
  dataUrl: string
  mimeType: string
  /** 原始 base64（不含 data URL 前缀） */
  base64: string
  prompt: string
  latencyMs: number
}

export interface ImageClient {
  generate(req: ImageRequest): Promise<ImageResult>
  ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }>
  getModel(): string
  getProviderName(): string
}
