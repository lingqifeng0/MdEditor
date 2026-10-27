# 滚动性能与悬浮目录定位修复

## Goal

修复 v8.33 在大图片 Markdown 笔记中滚轮滚动卡顿，以及右侧悬浮目录的当前位置指示在向下滚动后滞后或指向错误的问题。修复应保留现有悬浮目录层级、颜色、搜索、折叠、跳转和固定位置行为。

## What I already know

* 用户报告 v8.33 仍然存在大图滚动卡顿，并且悬浮目录的当前位置指示在向下滚动时不准确。
* `packages/desktop/src/renderer/src/components/floatingToc/index.vue` 在每次编辑器 scroll 的 `requestAnimationFrame` 中查询全部标题并逐个调用 `getBoundingClientRect()`，随后还可能调整目录列表自身的 scrollTop。
* 当前悬浮目录的 active 状态通过标题 viewport 坐标与编辑器 viewport 顶部比较；滚动事件与布局测量共用同一帧，图片/标题较多时会造成布局读取开销和视觉滞后。
* Muya 的图片/段落/表格 hover 热路径已经复用原始 mouse event 的目标路径，但非零偏移仍保留真实 hit-test；该合同位于 `.trellis/spec/core/frontend/pointer-hover.md`。
* 现有 v8.33 的 HTML 文本框边界修复与 Windows ripgrep 打包修复已经验证并发布；本任务只针对滚动与悬浮目录，不修改独立视频插件。

## Requirements

* 编辑器滚轮滚动时减少同步布局读取和重复的全标题测量，尤其是在图片较多的笔记中。
* 当前位置指示必须在连续向下滚动、快速滚动、滚动到底部和图片加载改变标题位置后仍与当前可视章节一致。
* 标题内容、层级、HTML 颜色、折叠/展开、搜索、固定与跳转行为保持不变。
* Muya pointer hit-test 既有偏移探测和悬浮工具遮挡规则不能被破坏。
* 不改用户笔记、已安装程序、独立 `video-study` 插件或其播放器逻辑。

## Acceptance Criteria

* [x] 使用真实或等价的长 Markdown 笔记连续滚轮向下滚动时，主线程帧不再因悬浮目录的全量布局测量持续阻塞；记录修复前后可复现的代表性指标。
* [x] 向下滚动到中段、快速跨越多个标题和文档底部时，悬浮目录 active 行/窄条指示与当前章节一致。
* [x] 图片加载、窗口尺寸改变或正文编辑后，标题位置缓存会失效并重新测量，不使用旧坐标。
* [x] 现有悬浮目录外观/交互 E2E、Muya pointer 单元测试和新增滚动定位回归测试通过。
* [x] desktop 与 Muya 类型检查、相关 lint 和 Electron 交互检查通过。

## Definition of Done

* 代码、回归测试、必要的规格/验证记录提交。
* 构建后的 Electron 测试使用隔离 profile；不上传或提交用户笔记、图片、性能 profile、安装包。
* 只有在修复和验证完成后才决定是否制作新的 Windows 预览；本任务不自动覆盖现有 v8.33 发布资产。

## Out of Scope

* 不重做悬浮目录 UI，不改变标题层级/颜色设计。
* 不修改 HTML 布局编辑器和独立视频回看插件。
* 不把性能优化做成禁用图片交互或全局 pointer 监听。

## Technical Notes

* 相关代码：`packages/desktop/src/renderer/src/components/floatingToc/index.vue`、`packages/desktop/src/renderer/src/util/floatingToc.ts`、`packages/desktop/src/renderer/src/util/findActiveHeading.ts`、`packages/desktop/test/e2e/floating-toc-appearance.spec.ts`、`packages/desktop/test/unit/specs/floating-toc.spec.ts`。
* 相关 Muya 代码与合同：`packages/muya/src/utils/pointerHitTest.ts`、`.trellis/spec/core/frontend/pointer-hover.md`。
* 需区分滚动时的轻量 active 计算与布局变化时的标题坐标重新测量，避免用长期 DOM 坐标缓存掩盖图片加载/编辑造成的移动。
