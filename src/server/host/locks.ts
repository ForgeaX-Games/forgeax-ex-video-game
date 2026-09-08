/**
 * 跨模块锁名（withLocks 的稳定 key）。独立成文件避免 extension-service ↔
 * component-authoring 之间的 import 环（component-authoring 写 blueprint 需
 * 要 GRAPH_SAVE_LOCK，而 extension-service 现在也 import component-authoring）。
 */
export const GRAPH_SAVE_LOCK = 'game-video-graph-save'
