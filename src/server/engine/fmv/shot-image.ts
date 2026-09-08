/**
 * [vendored · reel-fmv-merge-plan.md §0.5 / P2 · Option B] 关键帧 prompt 薄 builder。
 *
 * 依裁决表：**关键帧 = reel `buildShotKeyframePrompt` 骨 + 并入 FMV action/dialogue 绝对视觉化协议**。
 *
 * 逐字来源（一字未改）：
 *   · 英文分层段（Visual style / Location / Characters present / Shot N / FRAMING_DESCRIPTIONS /
 *     Audio cues / Performance & subtext / Cinematic widescreen 收尾）——搬自 reel
 *     `src/llm/forge/forgeImagePipeline.ts:buildShotKeyframePrompt`。
 *   · 中文协议常量（VARIANT_HEADERS / buildPovLine / ACTION_VISUALIZATION_PROTOCOL /
 *     DIALOGUE_VISUALIZATION_PROTOCOL / SHOT_IMAGE_QUALITY_CHECKLIST / FORBIDDEN_LINE /
 *     VISUAL_ANCHORS_LABEL / buildNodeSummaryLine）——搬自 FMV
 *     `lib/server/prompts/production/shot-image.ts`。
 *
 * 唯一改动（每处标注理由）：reel 原函数消费 `Scenario`/`Scene`/`Shot`/`Location`/`Character`
 * 域对象；studio 侧数据来自 GameGraph node + registry 薄投影，故装配改为消费 `ShotImageInput`。
 * 各英文/中文段的措辞、顺序保真；差异仅在「数据从哪来」。grid_storyboard 变体归 P4。
 */

// ─── FMV 中文协议常量（逐字搬自 shot-image.ts）──────────────────────────────

export type ShotImageVariant = "video_first_frame" | "choice_pressure_frame";

const VARIANT_HEADERS: Record<ShotImageVariant, string> = {
  choice_pressure_frame:
    "电影感抉择压力帧静照（选择界面浮现瞬间）。核心要求：定格在呼吸停顿的刹那，营造强烈的决策张力，右侧预留 1/3 负空间给选项 UI。",
  video_first_frame:
    "电影感首帧静照（视频生成视觉锚点）。核心要求：画面稳定、构图完整、光影准确，能够作为视频生成的第一帧无缝延续。",
};

function buildNodeSummaryLine(title: string, trimmedBeat: string): string {
  return `节点：${title}。剧情节拍：${trimmedBeat}。`;
}

function buildPovLine(characterName: string): string {
  return `摄像机视角（POV）：完全模拟${characterName}的眼睛所见。✅ 可出现：手部、前臂、低头可见的躯干前部、影子。❌ 绝对禁止：${characterName}的面部、全身、背影、任何能看到完整身体的角度。画面主体是${characterName}所观察到的场景和其他角色，所有互动对象都面向镜头方向。`;
}

const VISUAL_ANCHORS_LABEL = "视觉锚点";
const VISUAL_ANCHORS_SEPARATOR = "，";

const ACTION_VISUALIZATION_PROTOCOL = [
  "【动作视觉化】",
  "动作写具体身体部位、速度和力度；情绪转成手、肩、眼神、距离、道具状态；画面捕捉动态关键帧，禁止静态摆拍。",
].join("\n");

const DIALOGUE_VISUALIZATION_PROTOCOL = [
  "【台词视觉化】",
  "禁止画面文字和对话气泡；台词只通过嘴型幅度、下颌、眼神、身体前倾/后撤和停顿表现；非说话者嘴唇自然闭合。",
].join("\n");

const SHOT_IMAGE_QUALITY_CHECKLIST = [
  "【镜头图自检】",
  "单幅完整画面；角色/场景/道具承接参考图；动作和台词可被看见；镜头语言至少体现焦点、景别、角度、构图、对焦或布光中的 4 项；无文字/UI/水印；无畸形人体。",
].join("\n");

const FORBIDDEN_LINE = [
  "【禁止】",
  "无字幕、无说明文字、无 Logo、无水印、无 UI；不得改变参考图中的身份、服装、场景结构、光源方向和道具材质；不得出现人体畸形或低质模糊。",
].join("\n");

// ─── reel 英文分层段（逐字搬自 buildShotKeyframePrompt）───────────────────

export type ShotFraming = "wide" | "medium" | "close" | "insert" | "ots" | "pov";

const FRAMING_DESCRIPTIONS: Record<ShotFraming, string> = {
  wide: "Wide establishing shot. The camera is far from the subject, showing the full environment and spatial relationships.",
  medium:
    "Medium shot. The camera frames the subject from roughly waist-up, keeping context visible but with the subject dominant.",
  close:
    "Close-up. The camera tightly frames the subject, with strong emphasis on facial expression or the single key object.",
  insert:
    "Insert shot. Extreme close-up on a small but significant detail (a prop, a hand, a fragment of text). Background is minimized.",
  ots: "Over-the-shoulder shot. Framed from behind one character\u2019s shoulder, looking toward another subject, keeping both in the frame.",
  pov: "Point-of-view shot. The camera takes the subject\u2019s eyes as its position; what appears is what the subject would see.",
};

// ─── 薄输入 ─────────────────────────────────────────────────────────────────

/** 出场角色薄投影（原 reel Character / FMV characterBible）。 */
export interface RefCharacter {
  name: string;
  appearance?: string;
  role?: string;
}

/** 关键帧 prompt 薄输入 —— orchestrate 从 GameGraph node + registry 参考图组装。 */
export interface ShotImageInput {
  /** 节点展示名。 */
  nodeName: string;
  /** 剧情节拍 / 画面动作（进节点摘要 + "This shot shows"）。 */
  beat: string;
  /** 组合后的视觉风格串（三轴 composeVisualPrompt 产物，P3 供给）。 */
  uiStylePrompt?: string;
  /** 场景描述（名称 — 描述）。 */
  location?: string;
  /** 出场角色。 */
  characters?: RefCharacter[];
  /** 景别。 */
  framing?: ShotFraming;
  /** 运镜提示。 */
  cameraHint?: string;
  /** 本镜序号 / 总镜数（"Shot N of M"）。 */
  shotIndex?: number;
  shotTotal?: number;
  /** 视角（'第一人称' 触发 POV 段）。 */
  perspective?: string;
  /** 本镜台词（表演视觉化）。 */
  dialogueLines?: string[];
  /** 表演指导。 */
  performance?: string;
  /** 潜台词。 */
  subtext?: string;
  /** 声音线索（音效视觉化）。 */
  soundCues?: string[];
  /** 视觉锚点。 */
  visualAnchors?: string[];
  /** 转场提示。 */
  transitionHint?: string;
  /** 参考图是否齐（orchestrate 注入）；true 时角色/场景外观交给参考图。 */
  refsReady?: boolean;
  /** 变体（默认 video_first_frame；choice_pressure_frame 抉择压力帧）。 */
  variant?: ShotImageVariant;
  /** 抉择浮现瞬间描述（choice_pressure_frame 用）。 */
  choiceRevealMoment?: string;
}

function trimTrailingStop(s: string): string {
  return s.replace(/[。.\s]+$/, "");
}

/**
 * 关键帧 / 分镜首帧 prompt 装配（薄输入版）。
 * 段序：变体题头(FMV) → 节点摘要(FMV) → POV(FMV) → Visual style(reel) → Location(reel)
 *   → Characters present(reel) → Camera/Shot/Framing(reel) → This shot shows(reel)
 *   → Audio cues(reel) → Performance & subtext(reel) → 动作视觉化(FMV) → 视觉锚点(FMV)
 *   → 台词视觉化(FMV) → Cinematic 收尾(reel) → 自检(FMV) → 禁止(FMV)。
 */
export function buildShotImagePrompt(input: ShotImageInput): string {
  const variant: ShotImageVariant = input.variant ?? "video_first_frame";
  const parts: string[] = [];

  // 1. 变体题头（FMV）
  parts.push(VARIANT_HEADERS[variant]);

  // 2. 节点摘要（FMV）
  parts.push(buildNodeSummaryLine(input.nodeName, trimTrailingStop(input.beat)));

  // 3. 抉择压力帧意图（FMV）
  if (variant === "choice_pressure_frame" && input.choiceRevealMoment?.trim()) {
    parts.push(`画面意图（抉择浮现瞬间三合一）：${trimTrailingStop(input.choiceRevealMoment.trim())}。`);
  }

  // 4. POV（FMV）
  if (input.perspective === "第一人称") {
    const povName = input.characters?.[0]?.name;
    if (povName) parts.push(buildPovLine(povName));
  }

  // 5. Visual style（reel）
  if (input.uiStylePrompt?.trim()) parts.push(`Visual style: ${input.uiStylePrompt.trim()}.`);

  // 6. Location（reel）
  if (input.location?.trim()) {
    parts.push(
      `Location: ${input.location.trim()}. Match the lighting, spatial orientation, and mood of the provided reference image of this location.`,
    );
  }

  // 7. Characters present（reel）
  if (input.characters?.length) {
    const anchors = input.characters
      .map((c) => (c.appearance?.trim() ? `${c.name} (${c.appearance.trim()})` : c.name))
      .join("; ");
    parts.push(
      `Characters present (visual anchors up-front): ${anchors}. Keep each character consistent with their provided turnaround reference \u2014 face, wardrobe, proportions, distinctive accessories.`,
    );
  }

  // 8. Shot header + framing + camera（reel）
  const shotHeader =
    input.shotIndex !== undefined && input.shotTotal !== undefined
      ? `Shot ${input.shotIndex + 1} of ${input.shotTotal}.`
      : "Current shot.";
  parts.push(shotHeader);
  if (input.framing) parts.push(FRAMING_DESCRIPTIONS[input.framing]);
  if (input.cameraHint?.trim()) parts.push(`Camera direction: ${input.cameraHint.trim()}.`);

  // 9. This shot shows（reel）
  if (input.beat.trim()) parts.push(`This shot shows: ${input.beat.trim()}.`);

  // 10. Audio cues visualize（reel）
  const audio = input.soundCues?.filter(Boolean).join("，");
  if (audio) {
    parts.push(
      `Audio cues to externalize visually (AI cannot render sound \u2014 translate to visible physical evidence): ${audio}. For each sonic element, render a matching physical cue \u2014 e.g. raindrops crown-splashing on metal, dust floating in a beam of light, breath condensing into white mist, ripples on a puddle.`,
    );
  }

  // 11. Performance & subtext（reel）
  const dialogueText = input.dialogueLines?.filter(Boolean).join(" / ");
  if (dialogueText || input.subtext?.trim() || input.performance?.trim()) {
    const perfBits: string[] = [];
    if (dialogueText) {
      perfBits.push(
        `Character speaks (do NOT render text/subtitles in the image \u2014 only show the body language of speaking): "${dialogueText}"`,
      );
    }
    if (input.performance?.trim()) perfBits.push(`Performance direction: ${input.performance.trim()}`);
    if (input.subtext?.trim())
      perfBits.push(`Subtext to externalize through micro-expression and posture: ${input.subtext.trim()}`);
    parts.push(
      `Performance & subtext: ${perfBits.join(" \u00b7 ")}. Translate emotion into tensed jaw, whitened knuckles, reddened eye rims, shoulder posture, not into written words.`,
    );
  }

  // 12. 动作视觉化（FMV）
  parts.push(ACTION_VISUALIZATION_PROTOCOL);

  // 13. 视觉锚点（FMV）
  if (input.visualAnchors?.length) {
    parts.push(`${VISUAL_ANCHORS_LABEL}：${input.visualAnchors.join(VISUAL_ANCHORS_SEPARATOR)}。`);
  }

  // 14. 台词视觉化（FMV）
  parts.push(DIALOGUE_VISUALIZATION_PROTOCOL);

  // 15. 转场（reel）
  if (input.transitionHint?.trim()) {
    parts.push(
      `Transition to next shot: ${input.transitionHint.trim()}. Compose the end of this frame so it flows naturally into that transition.`,
    );
  }

  // 16. Cinematic 收尾（reel）
  parts.push(
    "Cinematic widescreen composition, 2.39:1 anamorphic letterbox aesthetic, film grain texture, high detail, clean frame.",
  );

  // 17. 自检 + 禁止（FMV）
  parts.push(SHOT_IMAGE_QUALITY_CHECKLIST);
  parts.push(FORBIDDEN_LINE);

  return parts.filter(Boolean).join("\n");
}
