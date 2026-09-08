/**
 * ni-ui —— 节点配置面板（NodeInspector）专用视觉层。
 *
 * 所有规则都写在 `.ni-root` 作用域内：`global.css` 的控件 reset 是 lime 色板，供扩展其它
 * 面板使用，这里的 Figma 新稿是另一套（#2b2b2b + 橙），两者不能互相覆盖。
 *
 * token 取自 Figma 变量（1.3 造化工坊国内版 · 15635:81195）：
 *   颜色/色值/白 100% · 60% · 40% · 20% · 10% · 5%，正文 12 / 14 / 16（行高 1.5）。
 */
import { injectStyleOnce } from '@/editor/styles/injectStyle'

export const NI_ROOT_CLASS = 'ni-root'

/**
 * 注意：下面整段是模板字符串，注释里**不能出现反引号**（会提前终止字面量，
 * 报出一串莫名其妙的 TS 语法错误）。要引用类名/选择器就直接裸写。
 */
const NI_UI_CSS = `
/*
 * token 同时挂在面板根和几个「能独立出现在作用域外」的组件根上。
 * 自定义属性会继承，所以把它们声明在组件根上，NiSelect / NiAddMenu 这类控件被共享编辑器
 * 用到 .ni-root 之外时（ScenarioInspector、ComponentPropertyPanel）依然取得到值。
 * 用 :where() 是为了让这一块特异性为 0，永远不跟具体规则抢。
 */
:where(.${NI_ROOT_CLASS}, .ni-select-root, .ni-add-menu-root, .ni-portal) {
  --ni-panel: #2b2b2b;
  --ni-input: #1a1a1a;
  --ni-accent: #e8864a;

  --ni-w-100: #ffffff;
  --ni-w-60: rgba(255, 255, 255, 0.6);
  --ni-w-40: rgba(255, 255, 255, 0.4);
  --ni-w-20: rgba(255, 255, 255, 0.2);
  --ni-w-10: rgba(255, 255, 255, 0.1);
  --ni-w-08: rgba(255, 255, 255, 0.08);
  --ni-w-05: rgba(255, 255, 255, 0.05);

  --ni-radius: 8px;
  --ni-control-h: 27px;
  --ni-gap: 6px;
  --ni-section-pad: 16px;

  --ni-font: "PingFang SC", "Noto Sans SC", var(--font-sans);
  --ni-fs-body: 12px;
  --ni-fs-label: 16px;
  --ni-fs-meta: 14px;
}

.${NI_ROOT_CLASS} {
  background: var(--ni-panel);
  color: var(--ni-w-100);
  font-family: var(--ni-font);
  font-size: var(--ni-fs-body);
  line-height: 1.5;
}

/* ── 分区 ───────────────────────────────────────────────────────────────── */
.${NI_ROOT_CLASS} .ni-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: var(--ni-section-pad);
  border-bottom: 1px solid var(--ni-w-10);
}
.${NI_ROOT_CLASS} .ni-section:last-child { border-bottom: 0; }

.${NI_ROOT_CLASS} .ni-section-head {
  display: flex;
  align-items: center;
  gap: 7.331px;
  min-width: 0;
}
.${NI_ROOT_CLASS} .ni-section-head::before {
  content: '';
  flex: none;
  width: 2.749px;
  height: 10.996px;
  border-radius: 1.833px;
  background: var(--ni-accent);
}
.${NI_ROOT_CLASS} .ni-section-title {
  font-size: var(--ni-fs-label);
  font-weight: 400;
  color: var(--ni-w-100);
  letter-spacing: 0.9163px;
  white-space: nowrap;
}
.${NI_ROOT_CLASS} .ni-section-head-extra { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.${NI_ROOT_CLASS} .ni-section-body { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
/* 条目之间的分隔线：零高，上下净距由所在容器的 gap 给（分区默认 14px）。 */
.${NI_ROOT_CLASS} .ni-divider { flex: none; height: 0; border-top: 1px solid var(--ni-w-10); }

/* ── 字段：标签在上，控件在下 ───────────────────────────────────────────── */
.${NI_ROOT_CLASS} .ni-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.${NI_ROOT_CLASS} .ni-field-label {
  font-size: var(--ni-fs-label);
  color: var(--ni-w-60);
  display: flex;
  align-items: flex-end;
  gap: 6px;
  min-width: 0;
}
.${NI_ROOT_CLASS} .ni-field-hint { font-size: var(--ni-fs-meta); color: var(--ni-w-60); }
.${NI_ROOT_CLASS} .ni-field-control { display: flex; align-items: center; gap: var(--ni-gap); min-width: 0; }
.${NI_ROOT_CLASS} .ni-field-control > * { min-width: 0; }

/* ── 输入 / 下拉：同一只壳 ──────────────────────────────────────────────── */
.${NI_ROOT_CLASS} .ni-control,
.${NI_ROOT_CLASS} .ni-input,
.ni-select {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: var(--ni-control-h);
  padding: 5.498px 9.163px;
  background: var(--ni-input);
  border: 0.611px solid var(--ni-w-08);
  border-radius: var(--ni-radius);
  color: var(--ni-w-100);
  font-family: inherit;
  font-size: var(--ni-fs-body);
  line-height: 1.5;
  outline: none;
  box-shadow: none;
  transition: border-color 120ms ease;
}
.${NI_ROOT_CLASS} .ni-input:hover,
.ni-select:hover { border-color: var(--ni-w-20); }
.${NI_ROOT_CLASS} .ni-input:focus,
.ni-select:focus {
  border-color: var(--ni-accent);
  box-shadow: none;
}
.${NI_ROOT_CLASS} .ni-input::placeholder { color: var(--ni-w-40); }

/* ── 下拉（Figma Component 126 · 15635:81344） ───────────────────────────
 *
 * 收起 = 一只 Text Input 壳；展开 = **同一只壳**长高，把候选胶囊内联铺在触发行下面
 * （不是浮层，会把下方内容顶下去），与 Component 127「＋ 添加X」共用胶囊行样式。
 *
 * DOM 里那个 .ni-select-native 是真的 select 元素，只是透明且不吃鼠标：它继续承担无障碍
 * 语义（combobox / option）与既有测试的 fireEvent.change 入口，视觉全部由下面的壳接管。
 * ───────────────────────────────────────────────────────────────────────── */
.ni-select-root {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  /* 字色落在根上、触发行 inherit：调用方给根加行内 color（如失效引用标红）才盖得住。 */
  color: var(--ni-w-100);
}
/* 透明地盖在触发行上（只有 27px 高，展开后的候选行不会被它挡住）：
   鼠标、焦点、tooltip 都落在它身上，原生弹层由 mousedown 的 preventDefault 掐掉。 */
.ni-select-native {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 2;
  width: 100%;
  height: var(--ni-control-h);
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}
.ni-select-native:disabled { cursor: default; }
.ni-select-shell {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-width: 0;
  background: var(--ni-input);
  border: 0.611px solid var(--ni-w-08);
  border-radius: var(--ni-radius);
  transition: border-color 120ms ease;
}
.ni-select-shell:hover { border-color: var(--ni-w-20); }
.ni-select-shell.is-open { border-color: var(--ni-accent); }
.ni-select-root:focus-within .ni-select-shell { border-color: var(--ni-accent); }
.ni-select-shell.is-disabled { opacity: 0.55; }
/* 展开时箭头翻面，收起态高度不变（候选走浮层，不顶动表单）。 */
.ni-select-shell.is-open .ni-select-chevron { transform: rotate(180deg); }
.ni-select-chevron { transition: transform 120ms ease; }

.ni-select-trigger {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-width: 0;
  height: var(--ni-control-h);
  padding: 5.498px 9.163px;
  background: transparent;
  border: 0;
  border-radius: var(--ni-radius);
  color: inherit;
  font-family: inherit;
  font-size: var(--ni-fs-body);
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}
.ni-select-shell.is-open .ni-select-trigger { color: rgba(255, 255, 255, 0.5); }
.ni-select-shell.is-disabled .ni-select-trigger { cursor: default; }
.ni-select-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ni-select-value.is-placeholder { color: var(--ni-w-40); }
.ni-add-menu-root { display: flex; width: 100%; min-width: 0; }

/* 浮层挂在 body 上，容器自带 ni-root 才吃得到作用域样式；它本身不该有底色。 */
.ni-portal {
  background: transparent;
  z-index: var(--z-top, 9999);
}

/* 数字输入靠右、去掉 spinner —— 权重 / 毫秒都用它 */
.${NI_ROOT_CLASS} .ni-input-num { text-align: right; }
.${NI_ROOT_CLASS} .ni-input-num::-webkit-outer-spin-button,
.${NI_ROOT_CLASS} .ni-input-num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

/* ── 分段器（单次 / 循环、自动 / 手动） ─────────────────────────────────── */
.${NI_ROOT_CLASS} .ni-segmented {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  height: var(--ni-control-h);
  padding: 4px 8px;
  background: var(--ni-input);
  border: 0.611px solid var(--ni-w-08);
  border-radius: var(--ni-radius);
}
.${NI_ROOT_CLASS} .ni-segmented-item {
  flex: 1 0 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: var(--ni-radius);
  background: transparent;
  color: var(--ni-w-100);
  font-family: inherit;
  font-size: var(--ni-fs-body);
  line-height: 1.5;
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
/* :not(:disabled) 不只是语义——它把特异性抬到 (0,4,0)，压过上面那条通用 button:hover。 */
.${NI_ROOT_CLASS} .ni-segmented-item:hover:not(:disabled) { background: var(--ni-w-05); }
.${NI_ROOT_CLASS} .ni-segmented-item[aria-pressed='true'] {
  background: var(--ni-w-20);
  border-color: var(--ni-w-20);
}

/* ── 虚位「＋ 添加 X」按钮 ──────────────────────────────────────────────── */
.${NI_ROOT_CLASS} .ni-add-btn {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  min-height: 26px;
  padding: 4px 12px;
  background: transparent;
  border: 0.6px solid var(--ni-w-40);
  border-radius: var(--ni-radius);
  color: var(--ni-w-40);
  font-family: inherit;
  font-size: var(--ni-fs-body);
  line-height: 1.5;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}
.${NI_ROOT_CLASS} .ni-add-btn:hover:not(:disabled) {
  color: var(--ni-w-100);
  border-color: var(--ni-w-60);
  background: var(--ni-w-05);
}
.${NI_ROOT_CLASS} .ni-add-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* ── 「＋ 添加 X」展开的候选列表（Figma Component 127 · 15635:81666）
 *
 * 注意它不是浮层：稿子里这张列表**内联撑开在按钮下方**，宽度与按钮同宽，把下方内容顶下去。
 * 与表单下拉（Text Input 壳 + 原生弹层）是两套东西，别混用。
 * ───────────────────────────────────────────────────────────────────────── */
.ni-menu-list {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 12px 0;
  overflow-y: auto;
  background: var(--ni-input);
  border: 0.611px solid var(--ni-w-08);
  border-radius: var(--ni-radius);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
/* 「＋ 添加X」的候选层落在面板色上（Component 127）；下拉的落在输入色上（Component 126）。 */
.ni-menu-list.is-panel { background: var(--ni-panel); }
.ni-menu-row {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  padding: 2.082px 12px;
  background: transparent;
  border: 0;
}
.ni-menu-item {
  box-sizing: border-box;
  display: flex;
  flex: 1 0 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 2.082px 8.33px;
  background: var(--ni-w-10);
  border: 1.041px solid var(--ni-w-10);
  border-radius: 8.33px;
  color: var(--ni-w-60);
  font-family: inherit;
  font-size: 11.453px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.ni-menu-item:hover:not(:disabled),
.ni-menu-item[data-selected='true'] {
  background: var(--ni-w-20);
  border-color: var(--ni-w-20);
}
.ni-menu-item:hover:not(:disabled) { color: var(--ni-w-100); }
.ni-menu-item:disabled { opacity: 0.45; cursor: not-allowed; }
/* 下钻后的返回行：不是候选项，弱化成一条带左箭头的说明。 */
.ni-menu-item.is-back {
  justify-content: flex-start;
  gap: 6px;
  background: transparent;
  border-color: transparent;
  color: var(--ni-w-40);
}
.ni-menu-item.is-back:hover:not(:disabled) { background: var(--ni-w-05); color: var(--ni-w-60); }
/* 素材名可能很长：胶囊内单行省略，完整名走 title。 */
.ni-menu-item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 头部胶囊按钮（从此试玩 / 删除节点） ────────────────────────────────── */
.${NI_ROOT_CLASS} .ni-pill-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: none;
  padding: 4px 8px;
  background: var(--ni-w-05);
  border: 1px solid transparent;
  border-radius: var(--ni-radius);
  color: var(--ni-w-100);
  font-family: inherit;
  font-size: var(--ni-fs-body);
  line-height: 1.5;
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms ease;
}
.${NI_ROOT_CLASS} .ni-pill-btn:hover:not(:disabled) { background: var(--ni-w-10); }
.${NI_ROOT_CLASS} .ni-pill-btn.is-danger:hover:not(:disabled) { background: rgba(255, 107, 107, 0.18); }

/* ── 图标（mask 上色，几何来自 Figma 导出的 svg） ─────────────────────────
 * 这一条**不加 .ni-root 前缀**：ComponentInputsDisclosure 等共享组件同时渲染在面板内外，
 * 图标在作用域外必须照样显示。类名带 ni- 前缀，全局也不会撞上别人。
 * ───────────────────────────────────────────────────────────────────────── */
.ni-icon {
  display: inline-block;
  flex: none;
  background: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}

/* ── 只有图标的方形按钮（删除挂载 / 关闭事件） ──────────────────────────── */
.${NI_ROOT_CLASS} .ni-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: var(--ni-w-60);
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}
.${NI_ROOT_CLASS} .ni-icon-btn:hover:not(:disabled) { color: var(--ni-w-100); background: var(--ni-w-05); }
.${NI_ROOT_CLASS} .ni-icon-btn.is-danger:hover:not(:disabled) { color: #ff6b6b; background: rgba(255, 107, 107, 0.14); }

/* ── 卡片：一份挂载 / 一条结算 / 一条出边 ───────────────────────────────── */
.${NI_ROOT_CLASS} .ni-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
  padding: 0;
  background: transparent;
  border: 0;
}
.${NI_ROOT_CLASS} .ni-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.${NI_ROOT_CLASS} .ni-card-title {
  font-size: var(--ni-fs-label);
  color: var(--ni-w-100);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.${NI_ROOT_CLASS} .ni-card-head-extra { margin-left: auto; display: flex; align-items: center; gap: 6px; flex: none; }
/* 选中态描边：半径 = border-radius + outline-offset，取 2+6 落在设计语言的 8px 上
   （与界面挂载的聚焦描边同一档几何）。 */
.${NI_ROOT_CLASS} .ni-card.is-accent { outline: 1px solid var(--ni-accent); outline-offset: 6px; border-radius: 2px; }

/* 嵌在输入壳里的子面板（条件详情等） */
.${NI_ROOT_CLASS} .ni-subpanel {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: var(--ni-input);
  border: 0.611px solid var(--ni-w-08);
  border-radius: var(--ni-radius);
  min-width: 0;
}
.${NI_ROOT_CLASS} .ni-subpanel-title { font-size: var(--ni-fs-body); color: var(--ni-w-60); }

/* ── 标签片（1组件 / 2事件 / 应默 / 属性比例） ─────────────────────────── */
.${NI_ROOT_CLASS} .ni-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  padding: 2px 8px;
  background: var(--ni-w-20);
  border-radius: 6px;
  color: var(--ni-w-100);
  font-size: var(--ni-fs-body);
  line-height: 1.5;
  white-space: nowrap;
}
.${NI_ROOT_CLASS} .ni-chip.is-muted { background: var(--ni-w-10); color: var(--ni-w-60); }

/* 行内动作条（添加效果 / 新增节点连线 / 添加界面 / 隐藏界面） */
.${NI_ROOT_CLASS} .ni-action-row {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 12px);
  margin-left: 12px;
  min-height: 21px;
  padding: 2px 8px;
  background: var(--ni-w-20);
  border: 0;
  border-radius: var(--ni-radius);
  color: var(--ni-w-100);
  font-family: inherit;
  font-size: var(--ni-fs-body);
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}
.${NI_ROOT_CLASS} .ni-action-row:hover:not(:disabled) { background: rgba(255, 255, 255, 0.26); }
.${NI_ROOT_CLASS} .ni-action-row.is-quiet { background: var(--ni-w-10); }

/* ── 音量滑杆 ───────────────────────────────────────────────────────────── */
.${NI_ROOT_CLASS} .ni-slider {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  min-width: 0;
  height: 6px;
  padding: 0;
  border: 0;
  border-radius: 9999px;
  background: var(--ni-w-20);
  outline: none;
  cursor: pointer;
}
.${NI_ROOT_CLASS} .ni-slider:disabled { cursor: default; opacity: 0.5; }
.${NI_ROOT_CLASS} .ni-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border: 0;
  border-radius: 50%;
  background: var(--ni-w-100);
}
.${NI_ROOT_CLASS} .ni-slider::-moz-range-track { height: 6px; border: 0; border-radius: 9999px; background: var(--ni-w-20); }
.${NI_ROOT_CLASS} .ni-slider::-moz-range-progress { height: 6px; border-radius: 9999px; background: var(--ni-w-100); }
.${NI_ROOT_CLASS} .ni-slider::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 50%; background: var(--ni-w-100); }

.${NI_ROOT_CLASS} .ni-slider-wrap { position: relative; display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.${NI_ROOT_CLASS} .ni-slider-bubble {
  position: absolute;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  padding: 2px 10px;
  background: #4a4a4a;
  border-radius: 6px;
  color: var(--ni-w-100);
  font-size: var(--ni-fs-body);
  line-height: 1.5;
  pointer-events: none;
  white-space: nowrap;
}

/* ─────────────────────────────────────────────────────────────────────────
 * 共享编辑器的作用域归一
 *
 * ConditionEditor / EffectsEditor / ComponentFormFields / ValueExprEditor /
 * CascadingPicker 这些组件同时服务于本面板和 ScenarioInspector、
 * ComponentPropertyPanel 等仍是 lime 色板的界面，所以**不能**改它们自己的文件。
 * 这里只在 .ni-root 里把它们渲染出来的原生控件拉齐到新稿，出了这个作用域
 * 它们保持原样。
 * ───────────────────────────────────────────────────────────────────────── */
.${NI_ROOT_CLASS} input:not([type='range']):not([type='checkbox']):not([type='radio']),
.${NI_ROOT_CLASS} textarea,
.${NI_ROOT_CLASS} select {
  background: var(--ni-input);
  border: 0.611px solid var(--ni-w-08);
  border-radius: var(--ni-radius);
  color: var(--ni-w-100);
  font-family: inherit;
  font-size: var(--ni-fs-body);
  padding: 5.498px 9.163px;
}
.${NI_ROOT_CLASS} input:not([type='range']):not([type='checkbox']):not([type='radio']):focus,
.${NI_ROOT_CLASS} textarea:focus,
.${NI_ROOT_CLASS} select:focus {
  border-color: var(--ni-accent);
  box-shadow: none;
}
.${NI_ROOT_CLASS} input[type='checkbox'],
.${NI_ROOT_CLASS} input[type='radio'] { accent-color: var(--ni-accent); }

/* 只用「类 + 元素」这一档特异性（0,1,1）：ni-* 原语自己的 .ni-root .ni-xxx 规则是 (0,2,0)，
   天然压过它；各分区的作用域覆盖也能用普通选择器赢，不必到处写 !important。
   —— 早先这里挂了五个 :not(.ni-*) 把特异性推到 (0,6,1)，反而逼调用方加 !important。 */
.${NI_ROOT_CLASS} button {
  border-radius: 6px;
  font-family: inherit;
  font-size: var(--ni-fs-body);
}
.${NI_ROOT_CLASS} button:hover:not(:disabled) {
  background: var(--ni-w-10);
}

/* CascadingPicker 的触发器：弹层留在 body 上（不在作用域内），只对齐闭合态。 */
.${NI_ROOT_CLASS} .gc-cascade-trigger {
  min-height: var(--ni-control-h);
  padding: 5.498px 9.163px;
  background: var(--ni-input);
  border: 0.611px solid var(--ni-w-08);
  border-radius: var(--ni-radius);
  font-size: var(--ni-fs-body);
}
.${NI_ROOT_CLASS} .gc-cascade-trigger:hover,
.${NI_ROOT_CLASS} .gc-cascade-trigger[aria-expanded='true'] { border-color: var(--ni-accent); }
`

export function ensureNiUiStyle(): void {
  injectStyleOnce('ni-ui', NI_UI_CSS)
}
