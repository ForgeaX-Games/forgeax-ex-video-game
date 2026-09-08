/**
 * server/engine/axes —— 风格三轴（reel）组合层（reel-fmv-merge-plan.md §P3）。
 *
 * 把 GameGraph 传来的三轴 id（StyleAxes：artMedia / director / filmLook）收敛成合法 union，
 * 再调 vendored 的 reel 组合器产出各 prompt 段。三个组合器
 * （composeVisualPrompt / getAuthoringHint / serializePersonaToPrompt）**逐字 vendored、未改**，
 * 本文件只是 id 校验 + 组合 glue。
 *
 * 注意：本模块 import 会触发 llm/config 下 SKILL.md 的 fs 读取（三轴内容源），
 * 故只在需要三轴的 orchestrate 路径按需 import，不进 engine/index 主 barrel。
 */

import type { StyleAxes } from "@/authoring/assets/registry-types";
import {
  composeVisualPrompt,
  getAuthoringHint,
  VISUAL_STYLE_PRESETS,
  type VisualStyle,
} from "./llm/config/visualStylePresets";
import { coerceFilmLookId, type FilmLook } from "./llm/config/filmLookPresets";
import {
  coerceDirectorStyleId,
  resolveDirectorPersona,
  serializePersonaToPrompt,
} from "./llm/config/directorPersonas";

/** id → 合法 VisualStyle；非法/空 → undefined。 */
function coerceVisualStyleId(v: unknown): VisualStyle | undefined {
  if (typeof v !== "string") return undefined;
  const id = v.trim();
  return id in VISUAL_STYLE_PRESETS ? (id as VisualStyle) : undefined;
}

/** 组合后的三轴产物 —— orchestrate 按需喂各 builder。 */
export interface ComposedAxes {
  /** 合法化后的 art-media id（喂 shot-script/video 的 artStyle）。 */
  artMedia?: VisualStyle;
  /** 合法化后的 film-look id。 */
  filmLook?: FilmLook;
  /** 视觉风格前缀串（media 出图前缀 + 调色锚点）——喂 keyframe 的 uiStylePrompt。 */
  uiStylePrompt: string;
  /** 中文文风指令（作者文风 + 场景自适应）——可作 styleKeywords 供 shot-script/video。 */
  authoringHint: string;
  /** 导演 persona system markdown——喂 shot-script 文生文 system。 */
  directorSystem: string;
  /** 风格关键词数组（authoringHint 拆行）——喂 shot-script/video 的 styleKeywords。 */
  styleKeywords: string[];
}

/**
 * 把三轴 id 组合成 prompt 段。
 * @param axes    manifest.styleAxes 与 node 覆盖浅合并后的三轴 id
 * @param custom  导演 custom persona 自由文本（director='custom' 时用）
 */
export function composeAxes(axes: StyleAxes | undefined, custom?: string): ComposedAxes {
  const artMedia = coerceVisualStyleId(axes?.artMedia);
  const filmLook = coerceFilmLookId(axes?.filmLook);
  const director = coerceDirectorStyleId(axes?.director);

  const uiStylePrompt = composeVisualPrompt("", artMedia, filmLook);
  const authoringHint = getAuthoringHint(artMedia, filmLook);
  const persona = resolveDirectorPersona(director, custom);
  const directorSystem = serializePersonaToPrompt(persona);
  const styleKeywords = authoringHint
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    ...(artMedia ? { artMedia } : {}),
    ...(filmLook ? { filmLook } : {}),
    uiStylePrompt,
    authoringHint,
    directorSystem,
    styleKeywords,
  };
}
