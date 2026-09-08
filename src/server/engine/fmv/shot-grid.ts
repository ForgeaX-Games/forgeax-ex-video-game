/**
 * [vendored · reel-fmv-merge-plan.md §0.5 / P4 · Option B] 6 面板故事板 prompt 薄 builder。
 * 主装配 `buildShotGridStoryboardPrompt` 的 section 顺序、每段文本、各 block 装配函数
 * （buildEnvDetailBlock / buildPropContinuityBlock / buildDialogueCuesBlock /
 *  buildStoryboardContentAnchorBlock / buildImageIntegrityGuardrails /
 *  buildGridNodeContractBlock / sanitize*）逐字搬自 FMV
 * `lib/server/prompts/production/shot-grid.ts`，**一字未改**。
 *
 * 差异（仅适配数据入口，不动文案）：
 *  - 删 `skill: FmvRuntimeSkill` 入参（原文 `void skill` 未使用）。
 *  - 删 `getArtStyleConfig(artStyle)` + styleLabel（原文算出后从未用于输出）。
 *  - 删 `storyboardPlan` 分支及其 ProjectRecord/SceneNode 装配函数
 *    （buildStoryboardPlanForAsset / renderStoryboardPlan* / resolveShotContext …）——
 *    薄输入走 buildPanelNarrativeProtocol 默认 6 panel 协议。
 *  - `ENDING_LIGHT_PROMPTS` / `EndingKind` 逐字搬自 FMV `_shared/protocols.ts`（结局定格光影 SSOT）。
 */

import {
  ABSOLUTE_VISUALIZATION_PROTOCOL,
  AVOID_NEGATIVES,
  CAMERA_PROGRESSION_BLOCK,
  CONTINUITY_BLOCK_LINES,
  DIALOGUE_CUES_FOOTER,
  DIALOGUE_CUES_HEADER,
  DIALOGUE_VISUALIZATION_PROTOCOL,
  ENV_DETAIL_BLOCK_HEADER,
  ENV_DETAIL_TEMPLATES,
  FINAL_MONOCHROME_OVERRIDE,
  GRID_ENDING_CONTRACT_FIXED_LINES,
  GRID_ENDING_CONTRACT_TITLE,
  GRID_KEY_CHOICE_CONTRACT_FIXED_LINES,
  GRID_KEY_CHOICE_CONTRACT_TITLE,
  GRID_KEY_CHOICE_FOCUS_FALLBACK,
  GRID_LAYOUT_LABEL,
  GRID_PANEL_COUNT,
  IMAGE_INTEGRITY_GUARDRAIL_LINES,
  LABEL_INSTRUCTION_WITHOUT_LABELS,
  LABEL_INSTRUCTION_WITH_LABELS,
  LAYOUT_INSTRUCTION,
  ORIGINAL_SHOT_PROMPT_HEADER,
  PANEL5_ANCHOR_FIELD_LABELS,
  PANEL5_ANCHOR_PREFIX,
  PANEL_SEQUENCE_HEADER,
  PROP_CONTINUITY_FOOTER,
  PROP_CONTINUITY_HEADER,
  SANITIZE_LAYOUT_PATTERNS,
  SANITIZE_LEGACY_STYLE_PATTERN,
  SANITIZE_NEGATIVE_PROMPT_PATTERN,
  SANITIZE_NEGATIVE_REPLACE,
  STORYBOARD_CONTENT_ANCHOR_FOOTER,
  STORYBOARD_CONTENT_ANCHOR_HEADER,
  STORYBOARD_MARK_SYSTEM,
  STORYBOARD_QUALITY_CHECKLIST,
  TIME_LOCK_FOOTER,
  UPSTREAM_REFERENCE_HEADER,
  VISUAL_RHYTHM_LINES,
  VISUAL_STACKING_PRIORITY_LINES,
  buildAtmosphereOverrideBlock,
  buildContinuityStyleLine,
  buildForceTextualLine,
  buildHardLayoutLimits,
  buildHeaderLine,
  buildPanelNarrativeProtocol,
  buildPlaceholderRefReadyLine,
  buildReferenceCountLine,
  buildTimeOfDayLockLine,
  buildVisualConsistencyKeywordsLine
} from "./shot-grid-templates";

// ============================================================
// ENDING_LIGHT_PROMPTS —— 逐字搬自 FMV lib/server/prompts/_shared/protocols.ts
// ============================================================

export type EndingKind = "good" | "bad" | "neutral";

interface EndingLightPrompt {
  imageLighting: string;
  videoLighting: string;
  videoMotion: string;
  mustInclude: string[];
}

export const ENDING_LIGHT_PROMPTS: Record<EndingKind, EndingLightPrompt> = {
  good: {
    imageLighting: "\u6696\u91D1\u659C\u5149\u4ECE\u5DE6\u4E0A\u6253\u5165\uFF0C\u8F6E\u5ED3\u8FB9\u7F18\u6CDB\u8D77\u900F\u5149\u6668\u66E6\uFF0C\u4E3B\u4F53\u88AB\u6E29\u6DA6\u5149\u7EBF\u5305\u88F9",
    videoLighting: "\u5149\u7EBF\u9010\u6E10\u589E\u5F3A\uFF0C\u7531\u51B7\u7070\u8FC7\u6E21\u5230\u6696\u91D1\u8272\uFF0C\u8FB9\u7F18\u67D4\u5149\u968F\u547C\u5438\u9012\u589E\uFF0C\u8272\u6E29\u5411\u6668\u5149\u504F\u79FB",
    videoMotion: "\u955C\u5934\u7F13\u6162\u62C9\u8D77\uFF08\u63A8\u8FDB \u2192 \u4E0A\u5347\uFF09\uFF0C\u672B\u5E27\u5B9A\u683C\u4E8E\u6668\u5149\u4E2D\u82CF\u9192\u7684\u4E3B\u4F53\uFF0C\u4E0D\u505A fade out",
    mustInclude: ["\u6668\u5149"]
  },
  bad: {
    imageLighting: "\u51B7\u84DD\u4F4E\u7167\u5EA6\u4FA7\u9006\u5149\uFF0C\u6697\u90E8\u5927\u9762\u79EF\u5806\u79EF\uFF0C\u4E3B\u5149\u7184\u706D\u4EC5\u6B8B\u5149\u52FE\u52D2\u8F6E\u5ED3",
    videoLighting: "\u5149\u7EBF\u7531\u660E\u8F6C\u6697\uFF0C\u8272\u6E29\u538B\u4F4E\u81F3\u51B7\u84DD\uFF0C\u6B8B\u5149\u9010\u6E10\u7184\u706D\uFF0C\u9634\u5F71\u541E\u6CA1\u524D\u666F",
    videoMotion: "\u955C\u5934\u4E0B\u6C89\uFF08\u4FEF\u62CD \u2192 \u9501\u5B9A\u4F4E\u4F4D\uFF09\uFF0C\u672B\u5E27\u5B9A\u683C\u4E8E\u7184\u706D\u7684\u4E3B\u5149\u6E90\u6216\u5854\u9677\u7684\u4E3B\u4F53",
    mustInclude: ["\u51B7"]
  },
  neutral: {
    imageLighting: "\u534A\u660E\u534A\u6697\u4EA4\u754C\u5149\uFF0C\u9EC4\u660F\u6216\u65E5\u51FA\u524D\u65F6\u6BB5\uFF0C\u8272\u6E29\u4E2D\u6027\u504F\u9752\uFF0C\u660E\u6697\u5E73\u5206\u753B\u9762",
    videoLighting: "\u5149\u7EBF\u5728\u534A\u660E\u534A\u6697\u4E4B\u95F4\u7F13\u6162\u6447\u6446\uFF0C\u8272\u6E29\u4E0D\u505A\u51B3\u65AD\uFF0C\u6668\u660F\u4EA4\u754C\u7684\u6726\u80E7\u611F\u6301\u7EED",
    videoMotion: "\u955C\u5934\u6C34\u5E73\u6A2A\u79FB\u6216\u7F13\u6162\u73AF\u7ED5\uFF0C\u672B\u5E27\u5B9A\u683C\u4E8E\u6668\u660F\u4EA4\u754C\u7684\u4E2D\u7ACB\u6784\u56FE",
    mustInclude: ["\u6668\u660F"]
  }
};

// ============================================================
// Types（逐字搬自 FMV shot-grid.ts）
// ============================================================

export type ShotGridLayout = "six-panel";

/** 故事板节点级语义角色。 */
export type GridNodeRole = "ending" | "key-choice" | "multi-choice" | "regular";

export type ShotGridLocationBibleEntryInput = {
  name?: string;
  isPlaceholder?: boolean;
  keyMaterials?: string[];
  fixedProps?: string[];
  cinematicLightProgression?: string;
  spatialHierarchy?: string;
  depthOfFieldHint?: string;
  lighting?: { sources?: string; direction?: string; quality?: string };
  colorPalette?: string[];
  colorPaletteStructured?: { primary: string[]; secondary: string[]; accent: string[] };
  weatherOrAtmosphere?: string;
  groundTexture?: string;
  detailCloseups?: string[];
  environmentProductionNotes?: string;
  timeOfDayVariations?: Array<{
    period: string;
    lightingOverride: string;
    colorShift: string;
    atmosphereOverride: string;
  }>;
  visualConsistencyKeywords?: string[];
};

export type TimeOfDayVariation = NonNullable<
  ShotGridLocationBibleEntryInput["timeOfDayVariations"]
>[number];

export type ShotGridPropAnchor = {
  name: string;
  material: string;
  shape: string;
  colorPalette: string[];
  state?: string;
};

export type ShotGridDialogueCue = {
  panelRange: string;
  speaker?: string;
  spokenLine?: string;
  deliveryTiming?: string;
  subtext?: string;
  visualCue: string;
};

export type ShotGridCameraDirectiveInput = {
  angle?: string;
  composition?: string;
  depthOfField?: string;
};

type ShotGridStoryboardContentAnchor = {
  segmentLabel?: string;
  shotIndex?: number;
  durationSeconds?: number;
  sceneAnchor?: string;
  dialogueLines?: string[];
  voiceoverText?: string;
  speechBudgetSeconds?: number;
  transitionHint?: string;
  promptOverride?: string;
};

// ============================================================
// Mapper（逐字搬自 FMV shot-grid.ts）
// ============================================================

export function getShotGridPanelCount(): number {
  return GRID_PANEL_COUNT;
}

export function getShotGridLayoutLabel(): string {
  return GRID_LAYOUT_LABEL;
}

export function isMeaningfulPlaceholderValue(value: string | undefined): value is string {
  return Boolean(value && !/[（(]\s*待补充/.test(value));
}

export function filterMeaningfulPlaceholderArray(values: string[] | undefined): string[] {
  return (values ?? []).filter(isMeaningfulPlaceholderValue);
}

export function resolveTimeOfDayVariation(
  entry: ShotGridLocationBibleEntryInput,
  nodeTimeOfDay: string | undefined
): TimeOfDayVariation | undefined {
  if (!nodeTimeOfDay || !entry.timeOfDayVariations?.length) return undefined;
  return entry.timeOfDayVariations.find((v) =>
    nodeTimeOfDay.includes(v.period) ||
    (v.period === "golden-hour" && /黄昏|傍晚|夕/.test(nodeTimeOfDay)) ||
    (v.period === "morning" && /晨|早|清晨/.test(nodeTimeOfDay)) ||
    (v.period === "night" && /夜|晚/.test(nodeTimeOfDay)) ||
    (v.period === "noon" && /午|中午|正午/.test(nodeTimeOfDay))
  );
}

export function buildPanel5CameraAnchor(
  directive: ShotGridCameraDirectiveInput | undefined
): string {
  if (!directive) return "";
  const angle = directive.angle?.trim();
  const composition = directive.composition?.trim();
  const dof = directive.depthOfField?.trim();
  if (!angle && !composition && !dof) return "";
  const parts: string[] = [];
  if (angle) parts.push(`${PANEL5_ANCHOR_FIELD_LABELS.angle}=${angle}`);
  if (composition) parts.push(`${PANEL5_ANCHOR_FIELD_LABELS.composition}=${composition}`);
  if (dof) parts.push(`${PANEL5_ANCHOR_FIELD_LABELS.depthOfField}=${dof}`);
  return `${PANEL5_ANCHOR_PREFIX}${parts.join("; ")}.`;
}

export function resolveKeyChoiceFocus(choiceRevealMoment: string | undefined): string | undefined {
  if (!choiceRevealMoment) return undefined;
  const trimmed = choiceRevealMoment.trim();
  if (trimmed.length < 8) return undefined;
  return trimmed;
}

export function getEndingLabel(endingKind: "good" | "bad" | "neutral"): string {
  if (endingKind === "good") return "好结局";
  if (endingKind === "bad") return "坏结局";
  return "中立结局";
}

// ============================================================
// Builder input（薄输入版）
// ============================================================

export interface ShotGridInput {
  /** 上游镜头 prompt（会被 sanitize 到黑白线稿约束）。 */
  originalPrompt: string;
  /** 每格是否渲染序号/镜头笔记（默认 true）。 */
  panelLabels?: boolean;
  /** 附带参考图数量（≥1 时 image1=角色、image2=场景）。 */
  referenceCount?: number;
  /** 上游参考图文本摘要。 */
  referenceSummaries?: string[];
  /** 参考图上传不可用时的纯文本兜底。 */
  forceTextualReferenceStyle?: boolean;
  /** 场景 bible 入参（薄）。 */
  locationBibleEntry?: ShotGridLocationBibleEntryInput;
  /** 节点时段（命中 timeOfDayVariations 时锁定光影）。 */
  nodeTimeOfDay?: string;
  /** 大气强制覆盖。 */
  atmosphereOverride?: string;
  /** 道具连续性锚点。 */
  propAnchors?: ShotGridPropAnchor[];
  /** 台词/表演分配提示。 */
  dialogueCues?: ShotGridDialogueCue[];
  /** 场景参考图已就绪。 */
  sceneRefReady?: boolean;
  /** 节点语义角色（ending / key-choice 触发额外硬契约）。 */
  nodeRole?: GridNodeRole;
  /** 结局类型（nodeRole=ending 时用）。 */
  endingKind?: EndingKind;
  /** 关键抉择揭示时刻（nodeRole=key-choice 时用）。 */
  choiceRevealMoment?: string;
  /** Panel 5 节点级摄影锚点。 */
  nodeCameraDirective?: ShotGridCameraDirectiveInput;
  /** 分段剧情锚点。 */
  storyboardContentAnchor?: ShotGridStoryboardContentAnchor;
}

// ============================================================
// Builder（section 顺序 / 文案逐字对齐 FMV buildShotGridStoryboardPrompt）
// ============================================================

/**
 * 公共 API · 6 面板故事板 prompt 入口（薄输入版）。
 */
export function buildShotGridStoryboardPrompt(input: ShotGridInput): string {
  const {
    originalPrompt,
    panelLabels = true,
    referenceCount = 0,
    referenceSummaries = [],
    forceTextualReferenceStyle = false,
    locationBibleEntry,
    nodeTimeOfDay,
    atmosphereOverride,
    propAnchors,
    dialogueCues,
    sceneRefReady = false,
    nodeRole = "regular",
    endingKind,
    choiceRevealMoment,
    nodeCameraDirective,
    storyboardContentAnchor
  } = input;

  const panelCount = getShotGridPanelCount();

  const panel5CameraAnchor = buildPanel5CameraAnchor(nodeCameraDirective);
  const narrativeProtocol = buildPanelNarrativeProtocol(panel5CameraAnchor);

  const envDetailBlock = buildEnvDetailBlock(locationBibleEntry, nodeTimeOfDay, sceneRefReady);
  const storyboardAnchorBlock = buildStoryboardContentAnchorBlock(storyboardContentAnchor);
  const propContinuityBlock = buildPropContinuityBlock(propAnchors);
  const dialogueCuesBlock = buildDialogueCuesBlock(dialogueCues);
  const gridNodeContractBlock = buildGridNodeContractBlock(nodeRole, endingKind, choiceRevealMoment);
  const labelInstruction = panelLabels ? LABEL_INSTRUCTION_WITH_LABELS : LABEL_INSTRUCTION_WITHOUT_LABELS;
  const imageIntegrityGuardrails = buildImageIntegrityGuardrails(panelLabels);

  const atmosphereBlock = atmosphereOverride ? buildAtmosphereOverrideBlock(atmosphereOverride) : "";

  return [
    atmosphereBlock,
    buildHeaderLine(panelCount),
    FINAL_MONOCHROME_OVERRIDE,
    STORYBOARD_MARK_SYSTEM,
    "",
    buildReferenceCountLine(referenceCount),
    referenceSummaries.length
      ? [UPSTREAM_REFERENCE_HEADER, ...referenceSummaries.map((summary) => `- ${summary}`)].join("\n")
      : "",
    forceTextualReferenceStyle ? buildForceTextualLine() : "",
    LAYOUT_INSTRUCTION,
    ...buildHardLayoutLimits(panelCount),
    labelInstruction,
    imageIntegrityGuardrails,
    "",
    envDetailBlock.length ? [ENV_DETAIL_BLOCK_HEADER, ...envDetailBlock].join("\n") : "",
    "",
    storyboardAnchorBlock,
    "",
    propContinuityBlock.length ? propContinuityBlock.join("\n") : "",
    "",
    dialogueCuesBlock,
    "",
    CAMERA_PROGRESSION_BLOCK,
    "",
    gridNodeContractBlock,
    DIALOGUE_VISUALIZATION_PROTOCOL,
    CONTINUITY_BLOCK_LINES.header,
    buildContinuityStyleLine(),
    CONTINUITY_BLOCK_LINES.same,
    CONTINUITY_BLOCK_LINES.preserve,
    CONTINUITY_BLOCK_LINES.originalPromptRole,
    CONTINUITY_BLOCK_LINES.noVisibleDialogue,
    "",
    VISUAL_RHYTHM_LINES.header,
    VISUAL_RHYTHM_LINES.alternateShots,
    VISUAL_RHYTHM_LINES.focalLengthMatch,
    VISUAL_RHYTHM_LINES.screenDirection,
    panelLabels ? AVOID_NEGATIVES.withLabels : AVOID_NEGATIVES.withoutLabels,
    "",
    ...ABSOLUTE_VISUALIZATION_PROTOCOL,
    "",
    ...VISUAL_STACKING_PRIORITY_LINES,
    "",
    PANEL_SEQUENCE_HEADER,
    ...narrativeProtocol,
    "",
    STORYBOARD_QUALITY_CHECKLIST,
    "",
    ORIGINAL_SHOT_PROMPT_HEADER,
    sanitizeShotGridOriginalPrompt(originalPrompt, panelLabels),
    "",
    FINAL_MONOCHROME_OVERRIDE
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- envDetailBlock 装配 ----------

function buildEnvDetailBlock(
  entry: ShotGridLocationBibleEntryInput | undefined,
  nodeTimeOfDay: string | undefined,
  sceneRefReady: boolean
): string[] {
  if (!entry) return [];
  const block: string[] = [];

  const isPlaceholderEntry = entry.isPlaceholder === true;
  const resolvedTimeOfDay = resolveTimeOfDayVariation(entry, nodeTimeOfDay);

  if (resolvedTimeOfDay) {
    block.push(
      buildTimeOfDayLockLine(
        resolvedTimeOfDay.lightingOverride,
        resolvedTimeOfDay.colorShift,
        resolvedTimeOfDay.atmosphereOverride
      )
    );
  }

  if (isPlaceholderEntry) {
    if (sceneRefReady) {
      block.push(buildPlaceholderRefReadyLine(entry.name ?? ""));
      const meaningfulKeywords = filterMeaningfulPlaceholderArray(entry.visualConsistencyKeywords);
      if (meaningfulKeywords.length) {
        block.push(buildVisualConsistencyKeywordsLine(meaningfulKeywords));
      }
    }
  } else {
    if (!sceneRefReady) {
      if (entry.cinematicLightProgression) {
        block.push(ENV_DETAIL_TEMPLATES.lightProgression(entry.cinematicLightProgression));
      }
      if (entry.lighting) {
        const l = entry.lighting;
        block.push(
          ENV_DETAIL_TEMPLATES.lightingLock(
            l.sources ?? "natural",
            l.direction ?? "45° side",
            l.quality ?? "moderate"
          )
        );
      }
      if (entry.keyMaterials?.length) {
        block.push(ENV_DETAIL_TEMPLATES.keyMaterials(entry.keyMaterials));
      }
      if (entry.fixedProps?.length) {
        block.push(ENV_DETAIL_TEMPLATES.fixedProps(entry.fixedProps));
      }
      if (entry.spatialHierarchy) {
        block.push(ENV_DETAIL_TEMPLATES.spatialHierarchy(entry.spatialHierarchy));
      }
      if (entry.depthOfFieldHint) {
        block.push(ENV_DETAIL_TEMPLATES.depthOfFieldHint(entry.depthOfFieldHint));
      }
    }

    if (entry.colorPaletteStructured) {
      const cp = entry.colorPaletteStructured;
      block.push(
        ENV_DETAIL_TEMPLATES.colorPaletteStructured(cp.primary, cp.secondary, cp.accent)
      );
    } else if (entry.colorPalette?.length) {
      block.push(ENV_DETAIL_TEMPLATES.colorPalette(entry.colorPalette));
    }
    if (entry.weatherOrAtmosphere) {
      block.push(ENV_DETAIL_TEMPLATES.weatherLock(entry.weatherOrAtmosphere));
    }
    if (!sceneRefReady) {
      if (entry.groundTexture) {
        block.push(ENV_DETAIL_TEMPLATES.groundTexture(entry.groundTexture));
      }
      if (entry.detailCloseups?.length) {
        block.push(ENV_DETAIL_TEMPLATES.detailCloseups(entry.detailCloseups));
      }
      if (entry.environmentProductionNotes) {
        block.push(ENV_DETAIL_TEMPLATES.productionNotes(entry.environmentProductionNotes));
      }
    }
  }

  block.push(TIME_LOCK_FOOTER);
  return block;
}

// ---------- propContinuityBlock 装配 ----------

function buildPropContinuityBlock(propAnchors: ShotGridPropAnchor[] | undefined): string[] {
  if (!propAnchors?.length) return [];
  const block: string[] = [PROP_CONTINUITY_HEADER];
  for (const prop of propAnchors) {
    const parts = [
      prop.name,
      `材质=${prop.material}`,
      `形状=${prop.shape}`,
      `颜色=${prop.colorPalette.join(", ")}`
    ];
    if (prop.state) parts.push(`本节点状态=${prop.state}`);
    block.push(`- ${parts.join("; ")}`);
  }
  block.push(PROP_CONTINUITY_FOOTER);
  return block;
}

// ---------- dialogueCuesBlock 装配 ----------

function buildDialogueCuesBlock(dialogueCues: ShotGridDialogueCue[] | undefined): string {
  if (!dialogueCues?.length) return "";
  return [
    DIALOGUE_CUES_HEADER,
    ...dialogueCues.map((cue) => {
      const parts = [
        cue.deliveryTiming ? `节拍=${cue.deliveryTiming}` : "",
        cue.speaker ? `角色=${cue.speaker}` : "",
        cue.spokenLine ? `台词="${cue.spokenLine}"` : "",
        cue.visualCue ? `表演=${cue.visualCue}` : "",
        cue.subtext ? `潜台词=${cue.subtext}` : ""
      ].filter(Boolean);
      return `- ${cue.panelRange}：${parts.join("；")}`;
    }),
    DIALOGUE_CUES_FOOTER
  ].join("\n");
}

function buildStoryboardContentAnchorBlock(anchor: ShotGridStoryboardContentAnchor | undefined): string {
  if (!anchor) return "";
  const lines = [
    STORYBOARD_CONTENT_ANCHOR_HEADER,
    anchor.segmentLabel ? `分段标签：${anchor.segmentLabel}` : "",
    typeof anchor.shotIndex === "number" ? `分段序号：第 ${anchor.shotIndex} 段` : "",
    typeof anchor.durationSeconds === "number" ? `目标时长：${anchor.durationSeconds}s` : "",
    anchor.sceneAnchor ? `分镜指令：${anchor.sceneAnchor}` : "",
    anchor.dialogueLines?.length ? `本段台词：${anchor.dialogueLines.map((line) => `「${line}」`).join(" / ")}` : "",
    anchor.voiceoverText ? `本段旁白：${anchor.voiceoverText}` : "",
    typeof anchor.speechBudgetSeconds === "number" && anchor.speechBudgetSeconds > 0
      ? `口播预算：${anchor.speechBudgetSeconds}s（6 面板动作节奏必须给发声留白）`
      : "",
    anchor.transitionHint ? `衔接方式：${anchor.transitionHint}` : "",
    anchor.promptOverride ? `补充约束：${anchor.promptOverride}` : "",
    STORYBOARD_CONTENT_ANCHOR_FOOTER
  ].filter(Boolean);
  return lines.length > 2 ? lines.join("\n") : "";
}

// ---------- imageIntegrityGuardrails 装配 ----------

function buildImageIntegrityGuardrails(panelLabels: boolean): string {
  return [
    ...IMAGE_INTEGRITY_GUARDRAIL_LINES.prefix,
    panelLabels
      ? IMAGE_INTEGRITY_GUARDRAIL_LINES.withLabels
      : IMAGE_INTEGRITY_GUARDRAIL_LINES.withoutLabels
  ].join("\n");
}

// ---------- gridNodeContractBlock 装配（G5 节点级硬契约） ----------

function buildGridNodeContractBlock(
  nodeRole: GridNodeRole,
  endingKind: EndingKind | undefined,
  choiceRevealMoment: string | undefined
): string {
  if (nodeRole === "ending" && endingKind) {
    const entry = ENDING_LIGHT_PROMPTS[endingKind];
    const endingLabel = getEndingLabel(endingKind);
    return [
      GRID_ENDING_CONTRACT_TITLE,
      `结局类型：${endingKind}（${endingLabel}）。`,
      `Panels 5-6 必须收敛到结局定格：${entry.imageLighting}。`,
      GRID_ENDING_CONTRACT_FIXED_LINES.panel9Final,
      `本段硬契约中必须出现以下词之一：${entry.mustInclude.join(" / ")}。`,
      GRID_ENDING_CONTRACT_FIXED_LINES.lightingDirectionLock
    ].join("\n");
  }
  if (nodeRole === "key-choice") {
    const focus = resolveKeyChoiceFocus(choiceRevealMoment) ?? GRID_KEY_CHOICE_FOCUS_FALLBACK;
    return [
      GRID_KEY_CHOICE_CONTRACT_TITLE,
      `Panels 4-6 必须持续推向抉择压力焦点（提取自 choiceRevealMoment）：${focus}。`,
      GRID_KEY_CHOICE_CONTRACT_FIXED_LINES.panel9Freeze,
      GRID_KEY_CHOICE_CONTRACT_FIXED_LINES.panel9Composition,
      GRID_KEY_CHOICE_CONTRACT_FIXED_LINES.forbidden
    ].join("\n");
  }
  return "";
}

// ---------- sanitize 上游 originalPrompt ----------

export function sanitizeShotGridOriginalPrompt(
  value: string,
  panelLabels: boolean
): string {
  const base = sanitizeLegacyShotStyle(value);
  let result = base.replace(
    SANITIZE_NEGATIVE_PROMPT_PATTERN,
    panelLabels ? SANITIZE_NEGATIVE_REPLACE.withLabels : SANITIZE_NEGATIVE_REPLACE.withoutLabels
  );
  for (const [pattern, replacement] of SANITIZE_LAYOUT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function sanitizeLegacyShotStyle(value: string): string {
  return value.replace(
    SANITIZE_LEGACY_STYLE_PATTERN,
    "Style: black-and-white hand-drawn pencil line-art storyboard only, monochrome rough sketch, no color fill, no colored background, no colored clothing, no painterly rendering; color only for annotation arrows and tiny markup symbols."
  );
}
