# 修复 HTML 文字框越界

## Goal

让 HTML 可视编辑器里的文字框和图片一样受 HTML 外框约束。新增或已有文字框在预览、拖动、缩放和应用修改后都应保持在整体 HTML 外框内部，避免文字出现在外框下方或超出右边界。

## What I already know

* 用户提供的截图显示新增文字框“新文字”出现在 HTML 范围下方，明显没有跟随图片一样被外框限制。
* 现有编辑器组件是 `packages/desktop/src/renderer/src/components/htmlLayoutEditor/index.vue`。
* HTML 源码映射和补丁逻辑在 `packages/desktop/src/renderer/src/util/htmlLayout.ts`；边界计算在 `htmlLayoutBounds.ts`。
* 新文字框当前使用绝对定位；图片已经有独立的边界约束，但文字框走的是通用的无限制拖动/缩放逻辑。
* HTML 布局契约要求新增文字框在完整外框内、保留源代码字节、Apply/Cancel/Undo 行为一致，并补充回归测试。
* GitHub 上 v8.31 发布被误删；本地仍保留 `v0.31.0-toolbar.v8.31` 标签和 `Windows-v8.31` 交付文件，完成修复后需要恢复该发布。

## Assumptions

* “限制在里面”指文字框的外接矩形不能越过整体 HTML 外框的内容边界；文字框内容本身允许在框内换行，超出文字框高度的部分按现有 HTML/CSS 行为处理。
* 整体外框保持原来的流式尺寸和位置；为绝对定位文字提供包含块时可以补充 `position: relative`，不改变正常流布局。
* 文字框的字号、颜色、添加、删除、源代码编辑和独立草稿历史保持现有行为。

## Requirements

* 新增文字框时，确保整体 HTML 外框是绝对定位文字的包含块，并把初始文字框放入外框可用区域。
* 拖动文字框时，将其位置限制在整体 HTML 外框内容边界内。
* 调整文字框大小时，宽度和高度不能把文字框推到整体 HTML 外框之外；已有文字框若起点在边界外，编辑时应能被约束回合法区域。
* Apply 后生成的 HTML 仍能在正文预览和重新打开编辑器时保持同样的边界行为。
* 现有图片的拖动、缩放、重叠检查、删除和布局行为不得回归。
* 增加至少一个回归测试覆盖新增文字框初始位置和拖动/缩放边界；保留现有 HTML 文字框测试。
* 恢复 GitHub `v0.31.0-toolbar.v8.31` 标签对应的公开 Release，使用本地 `Windows-v8.31` 交付文件；本次修复发布为 v8.33，v8.32 作为上一版保留。

## Acceptance Criteria

* [ ] 新增文字框的 bounding box 完全位于整体 HTML 外框内容矩形内。
* [ ] 将文字框拖向任意外边界后，松开鼠标仍不会越界。
* [ ] 将文字框缩放到超过外框的尺寸时，尺寸被限制在可用空间内。
* [ ] Apply、Cancel、重新打开、保存/重开和 HTML 草稿撤销仍通过现有测试。
* [ ] 相关单元测试、HTML 布局 Electron 测试和类型检查通过，或记录环境阻塞。
* [ ] GitHub 上同时存在 v8.31、v8.32 和 v8.33 Release，v8.33 为最新版本。

## Definition of Done

* 回归测试覆盖边界行为。
* 相关 lint、类型检查和测试通过。
* HTML 布局契约或开发记录补充本次边界约束的实现要点。
* 代码与文档提交；不提交依赖、用户数据或生成的本地验证文件。

## Out of Scope

* 不修改独立视频回看插件的功能或职责。
* 不改变 HTML 编辑器的字号/颜色设置范围、文字框排序或图片重叠策略。
* 不删除本地或 GitHub 的 v8.31 历史交付。

## Technical Notes

* 已阅读：`AGENTS.md`、`.trellis/spec/guides/project-boundaries.md`、`.trellis/spec/marktext/frontend/html-layout.md`、`.trellis/spec/marktext/frontend/index.md`。
* 重点入口：`addText`、`startMove`、`beginPointer`、`movePointer`、`applyLiveEdit`、`imageBounds`。
* 现有边界辅助：`clampHtmlLayoutImageOffset`、`fitHtmlLayoutImageSize`；应优先复用或抽取通用逻辑，避免重复实现。

## Verification Notes

* HTML 布局相关 Vitest：9 个测试文件、366 项通过。
* 完整 desktop unit：117 个测试文件通过，1708 项通过；另外 2 个既有图片测试因初始环境缺少 `ced` 原生绑定而无法加载，未涉及本次改动；使用已有兼容原生模块后，HTML Electron 测试可正常启动。
* Desktop renderer `vue-tsc --noEmit` 和本次改动文件 ESLint 通过。
* 开发目录 Electron HTML 测试：11 项全部通过，包含文字框拖动/缩放边界、撤销重做、源码往返、保存重开和删除行为。
* v8.33 Windows x64 构建完成；便携 ZIP、安装包、EXE 名称、app.asar 版本和 `ced`/`keytar` 原生模块均已检查。直接启动打包 EXE 的 Playwright smoke 因 packaged app 未在 30 秒内返回窗口而超时，开发目录 Electron 测试已覆盖同一功能路径。
