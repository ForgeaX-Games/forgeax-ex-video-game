/**
 * [vendored · reel-fmv-merge-plan.md §0.5 / P4] 6 面板故事板 prompt 文案 SSOT。
 * 逐字搬自 FMV `lib/server/prompts/production/shot-grid-templates.ts`，**一字未改**（本文件
 * 原本零 import、纯字符串常量 + 纯函数，直接整体搬运，无需任何适配）。
 */

// ---------- 布局 / 数量 / label ----------

export const GRID_LAYOUT_LABEL = "2x3 六面板故事板";

export const GRID_PANEL_COUNT = 6;

// ---------- 顶层布局指令 ----------

export const LAYOUT_INSTRUCTION = [
  "LAYOUT CONTRACT: 16:9 storyboard table with EXACTLY 6 PANELS TOTAL.",
  "Use exactly 2 rows and 3 columns: row 1 has 面板1-3, row 2 has 面板4-6.",
  "Stop the storyboard after 面板6. The final panel must be the strongest climax or ending freeze-frame.",
  "Under EACH panel, render one short Chinese story caption line describing that panel's plot beat.",
  "Each panel is a complete rough previsualization sketch with clear borders and no overlapping elements between panels."
].join(" ");

// ---------- Panel 5 anchor 模板 ----------

export const PANEL5_ANCHOR_PREFIX = " 节点级摄影锚点：";
export const PANEL5_ANCHOR_FIELD_LABELS = {
  angle: "摄影角度",
  composition: "构图",
  depthOfField: "景深"
} as const;

// ---------- 6 个 panel narrativeProtocol（核心硬契约） ----------

export function buildPanelNarrativeProtocol(panel5CameraAnchor: string): string[] {
  return [
    "面板1｜建立环境｜远景 / 广角｜角色与场景关系首次出现；用绿色构图标记主体位置，用橙色标记主光方向；面板下方写一行中文故事情节。",
    "面板2｜行动触发｜中景 / 轻微跟拍｜角色进入动作节拍，目标或压力源被看见；红色箭头标出身体运动方向；面板下方写一行中文故事情节。",
    "面板3｜关键反应｜近景 / 手持推近｜手、眼睛、道具或压力源承担信息，角色重心和视线方向改变；蓝色箭头标出摄影机推近。面板下方写一行中文故事情节。",
    `面板4｜冲突升级｜中近景 / 斜角或小幅环绕｜人物关系、空间压力或道具状态发生反转；用紫色标记注明情绪、声音或叙事强调。${panel5CameraAnchor} 面板下方写一行中文故事情节。`,
    "面板5｜高潮动作｜大动作构图 / 快速跟随｜红色身体箭头和蓝色摄影机箭头同时出现，表现最强动作推进；面板下方写一行中文故事情节。",
    "面板6｜后果定格｜中远景或强构图定格｜展示动作结果、空间反馈和可接续末帧，形成最强视觉冲击和情绪收束；面板下方写一行中文故事情节。"
  ];
}

// ---------- 镜头推进段 ----------

export const CAMERA_PROGRESSION_BLOCK = [
  "6 面板镜头推进规则：",
  "1. 把剧情拆成 6 个连续推进的关键镜头，而不是 6 张孤立静态图。",
  "2. 每个面板必须包含可见动作、状态变化、镜头推进或情绪节奏变化。",
  "3. 使用电影感摄影：手持感、快速平移、推近、后拉、环绕运动、俯视、低角度、特写、长焦压缩均可按剧情需要分配。",
  "4. 环境保持简洁，只保留对剧情有帮助的关键场景元素；重点突出人物、动作、空间关系、光线方向和氛围。",
  "5. 最后一格必须是高潮或结尾定格，形成最强视觉冲击和情绪收束。",
  "6. 每格下方必须有一行简短中文故事情节，说明这一格发生了什么；不是对白字幕，也不是 UI。"
].join("\n");

// ---------- panel label 指令两档 ----------

export const LABEL_INSTRUCTION_WITH_LABELS = [
  "故事板标注契约：在每个面板内渲染小号黑色面板序号 1-6 和简短中文镜头笔记；在每个面板下方渲染一行更完整的中文故事情节。",
  "使用规定的彩色标注系统：红色箭头=身体运动方向，蓝色箭头=摄影机运动，绿色标记=构图/取景笔记，橙色标记=主光方向，紫色标记=情绪/声音/叙事强调，黑色文字=面板序号、镜头笔记和下方故事情节。",
  "标注文字一律使用中文。允许每格下方一行故事情节；禁止时间戳、对白字幕、对话气泡、UI 元素、水印、Logo、装饰性标题栏。"
].join(" ");

export const LABEL_INSTRUCTION_WITHOUT_LABELS = [
  "仅使用最少量故事板标注：小号黑色面板序号 1-6、规定的彩色箭头/标记，以及每格下方一行中文故事情节。",
  "不渲染对白字幕、对话气泡、时间戳、UI 元素、水印、Logo 或多行长段文字。",
  "保持黑色文字精短，一律使用中文；下方故事情节必须可读但控制在一行。"
].join(" ");

// ---------- 画面完整性硬负向 ----------

export const IMAGE_INTEGRITY_GUARDRAIL_LINES = {
  prefix: [
    "画面完整性硬负向：",
    "不允许出现：破碎图片、坍塌面板、重复面板、变形故事板几何、扭曲帧边框、缺失面板。",
    "不允许出现：马赛克、像素化、故障方块、损坏像素、压缩伪影、色带、撕裂、涂抹、模糊或低分辨率瑕疵。",
    "不允许出现：畸形面部、面部互换、重复面部、融化皮肤、扭曲手部、多余手指、断肢、变异解剖或不一致的角色身份。",
    "不允许出现：静态摆拍或僵硬身体语言——每个面板必须展示动作、状态变化、镜头推进或可读的张力。"
  ],
  withLabels:
    "除规定的 1-6 面板序号、简短中文镜头笔记和每格下方一行故事情节外，不得出现其他可读文字；禁止字幕、对话气泡、UI 叠层、水印或 Logo。",
  withoutLabels:
    "不允许出现：多行长段文字、字幕、对话气泡、UI 叠层、水印、Logo；每格下方一行中文故事情节除外。"
} as const;

// ---------- 题头 / styleLock / continuityStyle ----------

export function buildHeaderLine(panelCount: number): string {
  return `BLACK-AND-WHITE LINE ART CINEMATIC PREVIS STORYBOARD. Generate exactly ${panelCount} panels in a clean 16:9 storyboard table, arranged as 2 rows x 3 columns. Under each panel, add one short Chinese story caption line describing the plot beat. The actual storyboard drawing MUST be monochrome only: black pencil / black ink / graphite hatching on white paper, rough loose sketch lines, minimal detail, fast gesture energy, simple anatomy construction, strong readable silhouettes, lightweight and unfinished like early film previsualization. No color fill, no colored clothing, no colored background, no blue wash, no grey wash, no watercolor wash, no painterly rendering.`;
}

export function buildReferenceCountLine(referenceCount: number): string {
  return `Reference image count: ${referenceCount}. If references are attached, treat image 1 as the main character reference and image 2 as the scene reference when available. Use references as continuity anchors for character identity, wardrobe silhouette, props, scene architecture, and lighting direction — NOT as color/style references. Convert all reference colors into black-white line art and grey value contrast.`;
}

export const UPSTREAM_REFERENCE_HEADER = "上游参考图文本锚点：";

// ---------- 故事板内容锚点 ----------

export const STORYBOARD_CONTENT_ANCHOR_HEADER = "【剧情描述 · 必须拆解为 6 个连续推进的关键镜头】";

export const STORYBOARD_CONTENT_ANCHOR_FOOTER =
  "以上锚点是本故事板的具体剧情负载：把动作、台词、表演节拍和镜头推进分配到 6 个面板；每格都要有状态变化，每格下方必须有一行中文故事情节，最后一格必须成为高潮或结尾定格。";

export function buildStyleLockFallback(): string {
  return "Use the upstream reference text anchors only for character and scene continuity. The visual style is fixed: black-and-white rough pencil film storyboard, with color used only for annotation arrows/marks.";
}

export function buildContinuityStyleLine(): string {
  return "Style priority: draw the actual scene/characters/props as black-and-white rough pencil line art only. Color is allowed only on annotation arrows/marks (red/blue/green/orange/purple). If the original prompt asks for color palette, cinematic color grading, polished stills, anime color, blue rain wash, or rendered lighting, ignore the color/rendering and keep the monochrome storyboard sketch style.";
}

export function buildForceTextualLine(): string {
  return `Reference image upload is unavailable for this request. ${buildStyleLockFallback()}`;
}

export function buildHardLayoutLimits(panelCount: number): string[] {
  return [
    `Hard layout limit: the final image must contain exactly ${panelCount} rectangular frames and no extra frames.`,
    "Use only the 2x3 frame map described above. Keep the panel count exact.",
    "Each frame must reserve a small caption strip BELOW the drawing for one short Chinese story caption.",
    "Thin clean black borders, evenly spaced panels, professional storyboard sheet composition, no missing or merged panels."
  ];
}

// ---------- 大气覆盖 ----------

export function buildAtmosphereOverrideBlock(override: string): string {
  return `[MANDATORY SCENE ATMOSPHERE OVERRIDE — the artist MUST follow this direction above all other atmosphere/weather descriptions in the prompt below]:\n${override}\nThis override takes absolute priority. If any conflicting weather, atmosphere, or environment mood appears later in this prompt, ignore the conflicting description and follow ONLY this override.\n`;
}

// ---------- 场景细节段（envDetailBlock）模板 ----------

export function buildTimeOfDayLockLine(
  lighting: string,
  colorShift: string,
  atmosphere: string
): string {
  return `TIME-OF-DAY LOCK for all 6 panels: ${lighting}. Atmosphere: ${atmosphere}. Interpret any color shift "${colorShift}" only as black-white value contrast and shadow density, never as visible color fill. This is the ONLY lighting state for this storyboard — do not drift to any other time period.`;
}

export function buildPlaceholderRefReadyLine(sceneName: string): string {
  return (
    `Custom scene "${sceneName}" — visual identity is fully carried by the uploaded scene reference image. ` +
    `All 6 panels must inherit architecture, materials, lighting direction, atmosphere, and value contrast FROM THE REFERENCE IMAGE. ` +
    `Do NOT invent details that are not visible in the reference.`
  );
}

export function buildVisualConsistencyKeywordsLine(keywords: string[]): string {
  return `Visual consistency keywords (style anchors): ${keywords.join(", ")}.`;
}

export const ENV_DETAIL_TEMPLATES = {
  lightProgression: (progression: string) =>
    `Scene light arc reference (for cross-node continuity only, NOT for within-storyboard progression): ${progression}. Within this 6-panel storyboard, lighting must remain CONSTANT — do not simulate day-to-night within the storyboard.`,
  lightingLock: (sources: string, direction: string, quality: string) =>
    `Scene lighting lock: source=${sources}, direction=${direction}, quality=${quality}. Maintain across all panels.`,
  keyMaterials: (materials: string[]) =>
    `Key materials for texture continuity: ${materials.join(", ")}. At least 2 materials must be visible in Panels 1, 3, and 6.`,
  fixedProps: (props: string[]) =>
    `Fixed props as spatial anchors: ${props.join(", ")}. Must appear consistently in wide and medium frames.`,
  spatialHierarchy: (hierarchy: string) =>
    `Spatial depth layers: ${hierarchy}. Panel 1 must show all three layers; close-ups show foreground only with simplified background pencil lines.`,
  depthOfFieldHint: (hint: string) => `Depth of field guidance: ${hint}.`,
  colorPaletteStructured: (primary: string[], secondary: string[], accent: string[]) =>
    `Value hierarchy reference only — Primary forms: ${primary.join(", ")}; Secondary forms: ${secondary.join(", ")}; Accent details: ${accent.join(", ")}. Convert all colors to monochrome line weight, hatching, and grey value contrast. Do not render visible color fills.`,
  colorPalette: (palette: string[]) =>
    `Palette reference only: ${palette.join(", ")}. Convert these colors to black-white value contrast; do not render visible color fills.`,
  weatherLock: (weather: string) =>
    `MANDATORY Weather/atmosphere lock: "${weather}". ` +
    `This weather condition MUST be visually rendered in EVERY panel — show physical weather effects ` +
    `(e.g. rain streaks, wet surfaces, puddles, fog, snow, wind, mist, condensation) consistently across all 6 panels. ` +
    `Do NOT default to clear/sunny skies if the weather specifies otherwise. No random weather changes between panels.`,
  groundTexture: (texture: string) =>
    `Ground texture reference: ${texture}. Must be consistent in wide shots and the final panel.`,
  detailCloseups: (closeups: string[]) =>
    `Scene detail close-up references: ${closeups.join("; ")}. Use as texture/detail anchors in Panels 3-4.`,
  productionNotes: (notes: string) => `PRODUCTION HARD CONSTRAINT: ${notes}`
} as const;

export const TIME_LOCK_FOOTER =
  "TIME LOCK (MANDATORY): All 6 panels represent a SINGLE continuous story beat (approximately 10-15 seconds of real time). " +
  "Lighting direction, color temperature, shadow angle, weather state, and time-of-day must be IDENTICAL across all 6 panels. " +
  "Do NOT create a sunrise-to-sunset, day-to-night, or any temporal progression within this storyboard. " +
  "If reference images contain multi-panel time variations (e.g. Environment Production Sheet), only match the MAIN CENTER panel's lighting — ignore time variation panels.";

export const ENV_DETAIL_BLOCK_HEADER = "Scene environment layer:";

// ---------- 道具连续性段（propContinuityBlock）模板 ----------

export const PROP_CONTINUITY_HEADER =
  "【道具动作与连续性 · 特写格承载互动，收尾格保持状态】";

export const PROP_CONTINUITY_FOOTER =
  "When a prop appears in close-up panels, show distinguishing marks, material texture, and how the character is holding it. When a prop appears in wide panels, maintain correct silhouette and position relative to characters.";

// ---------- 台词视觉提示段（dialogueCues）模板 ----------

export const DIALOGUE_CUES_HEADER =
  "【台词 / 表演分配 · 用表情、嘴型、肢体和站位表现，禁止画成文字】";

export const DIALOGUE_CUES_FOOTER =
  "The quoted dialogue lines are INTERNAL performance cues only, never visible text. Speaking panels must show slightly parted lips, visible jaw movement tension, and matching emotional body language. Non-speaking panels show neutral closed-mouth resting state with appropriate emotional expression. Match dialogue intensity to physical performance: quiet lines = subtle movements; loud lines = exaggerated movements.";

// ---------- G5 节点级硬契约（结局 / 关键抉择） ----------

export const GRID_ENDING_CONTRACT_TITLE = "【6 面板结局定格硬契约】";

export const GRID_ENDING_CONTRACT_FIXED_LINES = {
  panel9Final:
    "Panel 6 为末帧定格：主体锁死画面中心（对称或强三分构图），不得 fade out，不得留扩展余地；给视频续接预留稳定一帧。动作完全静止，表情凝固。",
  lightingDirectionLock:
    "光影方向 / 色温 / 大气必须对齐结局光影，不得与 Panels 1-5 出现明暗倒置。使用橙色标记指示主光方向。"
} as const;

export const GRID_KEY_CHOICE_CONTRACT_TITLE = "【6 面板关键抉择推进硬契约】";

export const GRID_KEY_CHOICE_CONTRACT_FIXED_LINES = {
  panel9Freeze:
    "Panel 6 必须硬定格在压力焦点（凝滞 0.5 秒的瞬间 / 呼吸停顿 / 时间感放缓），为运行时选项浮现预留稳定帧。动作完全静止，只有眼睛在动。",
  panel9Composition:
    "Panel 6 的构图：三分构图，焦点偏左 25%，右侧保留 1/3 弱纹理/纯色负空间（给选项 UI 留位）。",
  forbidden: "禁止：动作中段模糊快门、选项 UI 文字（选项由运行时叠加）、任何动态模糊效果。"
} as const;

export const GRID_KEY_CHOICE_FOCUS_FALLBACK = "主角面部特写 + 可见压力道具";

// ---------- 续接 continuity / visual rhythm / 视觉化协议 ----------

export const CONTINUITY_BLOCK_LINES = {
  header: "连续性约束：",
  same:
    "所有面板保持相同角色、相同服装轮廓、相同发型、相同体型轮廓、相同场景布局、相同材质、相同光照方向、相同黑白线稿故事板风格。",
  preserve:
    "保留参考图中的角色身份和场景设计，不得重新设计角色或场景，精确匹配演员外貌。",
  originalPromptRole:
    "原始镜头提示词仅用于确定动作节拍、取景、运动节奏、情绪时机和面板排序。",
  noVisibleDialogue:
    "台词和旁白不得以可见文字出现，通过面部表情、肢体语言、舞台调度、道具和光影表现表演内容。"
} as const;

export const VISUAL_RHYTHM_LINES = {
  header: "视觉节奏要求：",
  alternateShots:
    "交替使用远景、中景、特写、极近特写、过肩镜头、低角度、高角度、跟拍构图和反应细节，同一景别不得连续重复三次。",
  focalLengthMatch:
    "焦距须与景别匹配：远景=24-35mm，中景=35-50mm，中近景=50-85mm，特写/极近特写=85-135mm；景深须与情绪匹配：亲密感=浅景深，环境感=深焦。",
  screenDirection:
    "保持清晰的银幕方向、入画方向和出画方向，避免连续性跳切、道具瞬移或无关联的替换设计，角色在面板间运动方向须保持一致。"
} as const;

export const AVOID_NEGATIVES = {
  withLabels:
    "禁止：水印、Logo、字幕、对白文字、对话气泡、标题栏、UI 叠层、时间戳、马赛克、像素方块、损坏伪影、服装不一致、发型变化、面部不一致、光照方向不一致、多余手指、畸形手部、面部扭曲、静态摆拍、僵硬身体语言、精致彩色插画、彩色填充、彩色服装、彩色背景、蓝色水洗、动漫着色、油画渲染、低质量、模糊。仅保留规定的面板序号、中文镜头笔记、每格下方故事情节和彩色故事板标记。",
  withoutLabels:
    "禁止：水印、Logo、字幕、长段文字、对话气泡、标题栏、UI 叠层、时间戳、马赛克、像素方块、损坏伪影、服装不一致、发型变化、面部不一致、光照方向不一致、多余手指、畸形手部、面部扭曲、静态摆拍、僵硬身体语言、精致彩色插画、彩色填充、彩色服装、彩色背景、蓝色水洗、动漫着色、油画渲染、低质量、模糊。"
} as const;

export const STORYBOARD_MARK_SYSTEM = [
  "故事板彩色标注系统（强制执行）：",
  "红色箭头 = 身体运动方向。",
  "蓝色箭头 = 摄影机运动。",
  "绿色标记 = 取景/构图笔记。",
  "橙色标记 = 主光方向。",
  "紫色标记 = 情绪/声音/叙事强调。",
  "黑色文字 = 简短镜头笔记、面板序号和每格下方故事情节（中文）。",
  "实际绘图本体必须保持黑白粗糙铅笔/墨线线稿。只有标注箭头和标记可以使用红/蓝/绿/橙/紫色。角色、服装、皮肤、道具、场景、天空、天气、阴影和光影不得着色。"
].join("\n");

export const ABSOLUTE_VISUALIZATION_PROTOCOL = [
  "Absolute visualization protocol (5 mandatory rules · all must pass before output):",
  "1. Emotion-to-action: NEVER use abstract emotion words (sad, nervous, lazy, angry) in visual descriptions. Translate ALL emotions into concrete body language: 'sad' → 'reddened eye rims, lower lip trembling, hands limp on knees'; 'nervous' → 'fingers unconsciously clutching fabric, shoulders raised, visible throat swallow'.",
  "2. Audio-to-visual: ALL sound cues must become visible props or physical states in the frame: 'ticking clock' → 'vintage brass clock on wall with visible hands'; 'rain' → 'dense water droplet trails sliding down window glass'; 'heartbeat' → 'chest fabric rising and falling with subtle breathing rhythm'.",
  "3. Material specificity: NEVER use vague adjectives ('nice clothes', 'pretty face'). Decompose into material + shape + wear level using monochrome cues: 'worn linen shirt with collar stain indicated by grey hatching', 'scuffed leather boots with visible sole wear in black line art'.",
  "4. Spatial positioning: specify element placement using composition terms: 'subject at right-third line', 'foreground blurred wire mesh', 'background depth fading into warm haze'.",
  "5. Dialogue-to-visual: ALL dialogue must be translated into facial expressions and body language as per the Dialogue Visualization Protocol. No text, subtitles, speech bubbles, or captions allowed in any frame.",
  "**All 5 rules must pass. If any panel description still contains abstract emotion words, raw sound cues, vague adjectives, unspecified spatial positions, or dialogue text, rewrite that panel until all 5 rules pass before output.**"
];

export const VISUAL_STACKING_PRIORITY_LINES = [
  "Visual stacking priority per panel (generator reads top-to-bottom):",
  "Style → Character features (face/hair/wardrobe silhouette) → Shot size & lens → Subject action & body language → Dialogue expression (lips/jaw/body tension) → Scene props & materials → Lighting direction as monochrome value → Atmosphere as line/hatching density."
];

// ---------- 台词视觉化协议（dialogueCues 的独立强化块） ----------

export const DIALOGUE_VISUALIZATION_PROTOCOL = [
  "Dialogue visualization protocol (MANDATORY for all speaking panels):",
  "1. Never render any text, subtitles, speech bubbles, or dialogue captions inside the frames.",
  "2. Translate all dialogue into concrete visual cues:",
  "   - Speaking: Slightly parted lips, visible jaw movement, appropriate facial expression",
  "   - Whispering: Lips barely moving, hand covering mouth, leaning in",
  "   - Shouting: Wide open mouth, furrowed brows, tense neck muscles",
  "   - Crying: Reddened eyes, tear streaks, trembling lips",
  "   - Angry: Clenched jaw, flared nostrils, raised voice posture",
  "   - Happy: Smiling mouth, crinkled eyes, relaxed shoulders",
  "3. Match body language to dialogue tone: hesitant speech = fidgeting hands; confident speech = upright posture; nervous speech = shifting weight.",
  "4. Non-speaking panels show neutral closed-mouth resting state with appropriate emotional expression."
].join("\n");

// ---------- 分镜质量自检清单 ----------

export const STORYBOARD_QUALITY_CHECKLIST = [
  "【分镜质量自检清单 · 必须全部满足】",
  "✅ 所有6个面板都已生成，布局为2行3列故事板表格",
  "✅ 每个面板下方都有一行简短中文故事情节，说明该格剧情进展",
  "✅ 实际故事板绘图仅为黑白粗糙铅笔/墨线与灰度明暗，人物、服装、背景、天空和灯光没有任何彩色填充",
  "✅ 彩色标注系统正确：红=身体运动，蓝=摄影机运动，绿=构图，橙=灯光，紫=情绪/声音/叙事，黑=镜头笔记",
  "✅ 所有动作都是具体可拍摄的物理动作，无抽象情绪词",
  "✅ 所有台词都通过面部表情和肢体语言表现，无字幕或对白气泡",
  "✅ 运镜与情绪匹配：静态=安静时刻，手持=紧张，推镜=情绪递进",
  "✅ 角色、服装、道具、场景在所有面板中保持一致",
  "✅ 光影方向、色温、天气在所有面板中保持一致",
  "✅ 没有畸形人体、多手指、扭曲面部等 AI 缺陷",
  "✅ 没有水印、Logo、字幕、UI、时间戳等多余元素",
  "✅ 第 6 个面板是全片高潮或结尾定格，视觉冲击最强",
  "生成前请再次检查以上所有项，确保分镜质量符合专业电影制作标准。"
].join("\n");

export const PANEL_SEQUENCE_HEADER = "面板执行序列：";
export const ORIGINAL_SHOT_PROMPT_HEADER = "原始镜头提示词：";

// ---------- sanitize 正则 SSOT ----------

export const SANITIZE_LEGACY_STYLE_PATTERN = /^Style:.*(?:anime|comix|comic|manga|ghibli|shinkai|illustration|photorealistic|live-action|live action).*$/gim;

export const SANITIZE_NEGATIVE_PROMPT_PATTERN = /^Negative prompt:.*(?:anime|manga|comic|illustration|concept art|digital painting|painterly|cartoon|3D render|game art).*$/gim;

export const SANITIZE_NEGATIVE_REPLACE = {
  withLabels:
    "Avoid: watermark, logo, subtitles, dialogue text, speech bubbles, title bars, UI overlays, timestamps, mosaic, pixelation, glitch blocks, corrupted pixels, inconsistent wardrobe, changed hairstyle, inconsistent face, inconsistent lighting direction, extra fingers, distorted hands, deformed faces, static poses, stiff body language, polished color illustration, color fill, colored clothing, colored background, blue wash, anime coloring, painterly rendering, low quality, blurry.",
  withoutLabels:
    "Avoid: watermark, logo, subtitles, long captions, speech bubbles, title bars, UI overlays, timestamps, mosaic, pixelation, glitch blocks, corrupted pixels, inconsistent wardrobe, changed hairstyle, inconsistent face, inconsistent lighting direction, extra fingers, distorted hands, deformed faces, static poses, stiff body language, polished color illustration, color fill, colored clothing, colored background, blue wash, anime coloring, painterly rendering, low quality, blurry."
} as const;

export const FINAL_MONOCHROME_OVERRIDE =
  "FINAL MONOCHROME OVERRIDE: The final image is a black-and-white hand-drawn line-art storyboard. All character drawings, clothing, props, architecture, weather, shadows, and backgrounds must be monochrome pencil/ink line work and graphite hatching only. Red/blue/green/orange/purple may appear ONLY as annotation arrows or tiny markup symbols. Never color the actual artwork. No colored fills, no colored clothes, no colored sky, no blue/grey wash, no watercolor wash, no painterly tonal blocks.";

export const SANITIZE_LAYOUT_PATTERNS: Array<readonly [RegExp, string]> = [
  [/2\s*[x×]\s*2\s*(grid|layout|storyboard)?/gi, "2x3 six-panel storyboard table"],
  [/3\s*[x×]\s*2\s*(grid|layout|storyboard)?/gi, "2x3 six-panel storyboard table"],
  [/2\s*[x×]\s*3\s*(grid|layout|storyboard)?/gi, "2x3 six-panel storyboard table"],
  [/3\s*[x×]\s*3\s*(grid|layout|storyboard)?/gi, "2x3 six-panel storyboard table"],
  [/12\s*[- ]?\s*(panel|grid|panels|grids|frame|frames)/gi, "6-panel storyboard table"],
  [/9\s*[- ]?\s*(panel|grid|panels|grids|frame|frames)/gi, "6-panel storyboard table"],
  [/4\s*[- ]?\s*(panel|grid|panels|grids|frame|frames)/gi, "6-panel storyboard table"],
  [/twelve\s*[- ]?\s*(panel|grid|panels|grids|frame|frames)/gi, "six-panel storyboard table"],
  [/nine\s*[- ]?\s*(panel|grid|panels|grids|frame|frames)/gi, "six-panel storyboard table"],
  [/four\s*[- ]?\s*(panel|grid|panels|grids|frame|frames)/gi, "six-panel storyboard table"],
  [/十二面板|12面板|十二格|12格/g, "六面板故事板"],
  [/九宫格|9宫格|九格|9格/g, "六面板故事板"],
  [/四宫格|4宫格|四格|4格/g, "六面板故事板"]
];
