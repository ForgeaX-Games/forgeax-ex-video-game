/**
 * server/engine —— vendored 生成 IP 内核对外 barrel（reel-fmv-merge-plan.md）。
 *
 * orchestrate.ts 的三步生产线只从这里取 prompt 构建器，不直接 reach 进 fmv/ 或 llm/。
 * 逐组件取更优（§2）：
 *   · 镜头脚本 = FMV 规则集（fmv/shot-script）
 *   · 关键帧   = reel 骨 + FMV 视觉化（fmv/shot-image）
 *   · 视频绑定 = FMV @图片N「名」 + SeedanceTaskMode（fmv/video-binding）
 */

// 镜头脚本（FMV）
export {
  buildNodeShotScriptPrompt,
  getShotCount,
  SEEDANCE_MAX_SHOT_DURATION,
  type ShotScriptInput,
} from "./fmv/shot-script";

// 关键帧 / 分镜首帧（reel 骨 + FMV 视觉化）
export {
  buildShotImagePrompt,
  type ShotImageInput,
  type ShotImageVariant,
  type ShotFraming,
  type RefCharacter,
} from "./fmv/shot-image";

// 6 面板黑白 previs 故事板（关键帧的可选替代分支，FMV）
export {
  buildShotGridStoryboardPrompt,
  ENDING_LIGHT_PROMPTS,
  type ShotGridInput,
  type EndingKind,
  type GridNodeRole,
} from "./fmv/shot-grid";

// 视频参考绑定（FMV）
export {
  buildSeedanceVideoPrompt,
  inferSeedanceTaskMode,
  softenSeedanceCutTerms,
  SEEDANCE_POLISH_SYSTEM_PROMPT,
  type SeedanceTaskMode,
  type SeedancePromptEntry,
  type VideoRefBinding,
  type VideoBindingInput,
} from "./fmv/video-binding";
