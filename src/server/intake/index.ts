/**
 * intake —— 跨模块**只读**拿料适配器归口。把别的模块已产出的图（角色立绘 / 场景贴图）
 * 映射成本 registry 的只读 ref 条目（externalPath 指回对方文件），供视频生成当参考图。
 *
 * 铁律：**只读**别的模块目录，绝不改它们的代码、绝不往它们目录写；registry 永远只有
 * game-video 一个写方（这里写的也只是指回外部文件的引用条目，不复制二进制）。
 */
export { importCharacterRefs, importCharacterRefsFromHost } from './characters'
export { importSceneRefs, importSceneRefsFromHost } from './scenes'
