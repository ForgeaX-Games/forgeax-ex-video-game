/**
 * video / templates · 视频 prompt 共用文案
 * ============================================================
 *
 * 仅保留跨 Seedance V2 prompt 与 Phase 3 仍共享的文案。
 */

// ---------- Layer 3 题头 ----------

/**
 * 视角镜头语言锁定段（视频 prompt + Phase 3 共用 SSOT）。
 *
 * 第一人称 → 主观 POV 镜头（永远不出现主角正面/侧面，摄影机 = 主角眼睛）；
 * 第三人称 → 正常电影镜头规划，不做人称机位限制，可使用远景 / 航拍 / 鸟瞰等镜头。
 *
 * @param perspective - 来自 SupervisorBrief.decisionBrief.playerRole.perspective
 * @param context - "video" 用于实时视频 prompt，"phase3" 用于 LLM 镜头脚本生成
 */
export function buildPerspectiveLockBlock(
  perspective: string | undefined,
  context: "video" | "phase3" = "video"
): string {
  if (!perspective) return "";
  const suffix = context === "phase3" ? " · 所有镜头必须遵循" : "";
  const prefix = context === "phase3" ? "seedancePrompt 中" : "画面中";
  switch (perspective) {
    case "第一人称":
      return [
        `【视角锁定 · 第一人称 POV${suffix}】`,
        "摄影机 = 主角眼睛。硬约束：",
        `1. ${prefix}永远不出现主角的正面、侧面或背影（摄影机即主角视野）；`,
        "2. 其他角色面朝摄影机方向说话/互动（制造「对着观众」的沉浸感）；",
        "3. 主角肢体仅允许出现：伸出的手/手臂、低头看到的躯干局部、影子；",
        "4. 镜头轻微呼吸浮动 + 视线随注意力转移自然摆动（模拟真实人眼）；",
        "5. 运镜不得出现环绕 / 第三人称外部机位 / 俯瞰——任何暴露主角全貌的机位都不合规。"
      ].join("\n");
    default:
      return [
        `【视角基线 · 第三人称电影镜头${suffix}】`,
        "按正常电影镜头规划处理，不做人称机位硬限制：",
        `1. ${prefix}可以根据叙事需要使用远景、航拍、鸟瞰、俯拍、过肩、特写、空镜或多角色调度；`,
        "2. 不要求摄影机紧随主角，也不要求主角始终入画；",
        "3. 只需保持场面调度、角色关系和信息揭示清晰，不得误写成第一人称 POV。"
      ].join("\n");
  }
}

/**
 * V-PROMPT-15 · Seedance 2.0 视频延长前置块。
 *
 * 触发条件：`buildSeedanceVideoPrompt` 收到 `extend=true`，并且绑定了上一段视频或
 * 服务端从上一段成片提取的真实尾帧。
 *
 * 注入位置：Layer 2 一致性合同之后、anchoring block 之前——让模型在解码 prompt
 * 顶部就锁定「延长任务 + 连续性锚点」语义，避免后续层把尾帧当成普通人物参考图
 * 处理（进而错误覆盖人物 / 跳切场景）。
 *
 * game-video 的服务端闭环把上一段真实尾帧作为 first_frame 参考图，所以这里不能
 * 固定声称存在 @视频1；锚点文字必须与本次实际绑定的输入槽一致。
 */
export function buildVideoExtendHeaderBlock(
  atSlot: string,
  source: "video" | "tail_frame",
): string {
  const anchor = source === "video"
    ? `${atSlot} 的尾帧`
    : `${atSlot}（上一段视频的真实尾帧）`;
  return [
    "【视频延长任务 · V-PROMPT-15】",
    `延续上一段视频内容，从 ${anchor} 无缝接续。`,
    `桥接帧策略：开场短暂保持 ${anchor} 的人物姿态、表情、光影和镜头位置高度一致，仅允许微幅自然运动，随后推进新动作。`,
    "衔接策略：上一段若在切镜或转场后结束，本段应从切镜后的新画面自然起始；禁止回退到上一段已完成动作。",
    `语义边界：${anchor} 只用于时序续接，不作为特效参考；特效运动逻辑必须使用独立特效参考素材说明。`,
    "硬约束（7 类全部满足才合规）：",
    `1. 人物身份：主角 / 配角的面部、发型、服装、瞳色严格沿用 ${anchor}，不得替换或变形；`,
    `2. 镜头位置：起始机位、焦距、视角与 ${anchor} 一致或合理推进，禁止跳切到无关机位；`,
    `3. 光影色温：主光源方向、色温、阴影柔和度与 ${anchor} 锁定，禁止跳变；`,
    `4. 表演节奏：角色姿态 / 表情 / 动作弧线从 ${anchor} 自然推进，禁止「重新开始」或重置；`,
    `5. 场景空间：地理方位、道具位置、入画方位与 ${anchor} 一致，禁止重置场景；`,
    "6. 帧间一致性：相邻帧之间物体位置、颜色、光影变化自然连续，无闪烁、无跳变、无物体变形——禁止任何帧间不一致；",
    `7. 禁止重复：不得复刻 ${anchor} 之前已经完成的动作 / 表情 / 台词，直接从新动作开始。`,
    "**7 类全过才合规，任一类违反需重写。**"
  ].join("\n");
}
