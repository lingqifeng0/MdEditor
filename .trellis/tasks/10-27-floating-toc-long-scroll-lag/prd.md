# 修复长时间滚动后浮动目录导致的卡顿

## Goal

解决用户在 MdEditor 中打开包含大量图片的 Markdown 笔记后，开始滚动时较流畅、持续一段时间后向下滚动逐渐迟钝的问题。用户已观察到关闭浮动目录后明显缓解，因此本任务要定位并降低浮动目录在长时间滚动、图片加载和正文布局变化期间对主线程的持续开销，同时保持目录当前位置指示准确。

## What I already know

* 用户反馈 v8.34 的短时滚动改善不稳定，长时间使用后卡顿会重新出现；VS Code 打开同类文档时明显更流畅。
* 关闭浮动目录后卡顿大幅缓解，说明浮动目录的滚动监听、布局观察、活动项更新或目录自身渲染仍可能是主要触发源。
* `packages/desktop/src/renderer/src/components/floatingToc/index.vue` 目前对编辑器滚动使用 `requestAnimationFrame` 更新活动标题，并对整个 `.mu-editor` 子树注册 `MutationObserver`，同时对编辑器和内容区注册 `ResizeObserver`；布局变化时会重新读取所有标题的 `getBoundingClientRect()`。
* 编辑器自身也在每次滚动事件中更新当前标签页的 `scrollTop` 并调用 1 秒防抖的缓冲状态保存；需要确认它是否与浮动目录活动项更新叠加。
* 现有短时回归测试只验证滚动路径中的标题布局读取次数，没有覆盖长时间滚动、连续图片加载、观察器回调数量或滚动保存开销。
* Trellis 任务 `10-27-scrolling-hover-accuracy` 已完成了第一轮短时优化，但用户反馈表明仍有长时场景未覆盖；本任务作为独立的第二轮修复和回归记录。

## Assumptions (temporary)

* 用户于 2026-10-28 用两个录屏明确纠正：收起窄条必须继续用蓝色活动刻度指示当前标题；章节多于可见范围后，刻度列表必须跟随活动标题滚动。先前“改为中性灰且停止跟随”的假设作废。
* 优先采用减少滚动热路径工作和限制观察器触发范围的方案，只有证据表明需要时才调整滚动位置持久化策略。
* 不修改用户笔记、已安装程序或独立 `video-study` 插件。

## Open Questions

* 无阻塞问题；先用代码和长时性能复现确定根因。

## Requirements

* 长时间连续向下滚动、反复上下滚动以及图片逐步加载后，浮动目录不会持续增加每帧工作或累计观察器/事件监听器。
* 浮动目录活动标题在快速滚动、中段、底部、图片加载后仍准确，并且不会因目录更新造成明显滚动延迟。
* 观察器只在确实可能改变标题位置或目录结构的变化上触发测量，避免对整个编辑器子树的高频无差别处理。
* 滚动位置保存不能在滚动热路径中引入同步序列化或重复状态更新；若需要调整，保持退出应用或切换文档时仍能保存位置。
* 收起窄条在顶部、中段和底部都必须有对应当前标题的蓝色刻度；只在活动刻度超出可见范围时滚动列表，使其始终可见。
* 目录搜索、分支折叠和展开面板的滚动位置不能使收起刻度丢失当前标题；收起刻度保留完整章节。展开后再收起，若正文没动，活动刻度位置保持；若正文已移动，则跟随新的当前标题。
* 展开面板仍保留目录搜索、折叠/展开、固定、跳转、标题层级、源颜色和源码模式。
* 增加可重复的长时性能回归测试，至少覆盖开启/关闭浮动目录对比、连续多轮滚动、图片/布局变化后的稳定性和监听器清理。

## Confirmed v8.37 hierarchy colors — 2026-10-28

The user approved the interactive three-level color example and explicitly requested implementation. The active heading remains theme blue, its immediate parent is teal (`#65c6a3` in dark themes), and its grandparent is amber (`#e8b45a` in dark themes). More distant ancestors use the ordinary neutral compact stroke. Light themes use darker hues in the same families for visibility. Determine these two ancestors from the actual heading tree, including skipped levels; do not assume the parent of H6 is always H5.

## Confirmed v8.38 expanded outline — 2026-10-28

The user clarified that expanded H1–H6 badges each need a distinct level color; heading text must match the document's theme and inline HTML colors. The current row uses a pale neutral translucent overlay only, with no current-position blue text or blue edge. Expanded H badges do not use parent/grandparent/current state colors. The compact rail retains its existing current/parent/grandparent colors and scroll behavior. Verify dark, light and multicolor themes, six badge colors, active and hover states, source-colored labels, compact transitions and scroll performance.

The user approved the cool-to-warm palette shown in `validation/floating-toc-v8.38/cool-to-warm-preview.png`: H1 blue, H2 cyan, H3 green, H4 yellow, H5 orange, H6 red. Use darker corresponding colors for light themes. Keep heading text and active-row highlighting unchanged.

Full ancestor traversal is retained for search reveal and folded-row navigation. The change must preserve fixed compact geometry, current-marker following, hover stability and the established scroll-performance contract. Ship a local v8.38 setup EXE and one portable ZIP, with the separate unchanged video-study 0.2.5 plugin and checksums. Preserve existing versions and keep source changes uncommitted as previously requested.

## Acceptance Criteria

* [x] 在包含大量图片和标题的长文档中，开启浮动目录连续滚动多轮后，滚动帧延迟和脚本耗时不随时间持续恶化；与关闭浮动目录相比差异处于可接受范围。
* [x] 测试能检测到浮动目录没有重复注册 scroll、MutationObserver、ResizeObserver 或 requestAnimationFrame 回调。
* [x] 快速跳转、向下滚动到底部、再返回顶部时活动标题与实际可见标题一致。
* [x] 图片加载或正文布局改变后标题坐标会重新校准，但不会在滚动期间逐标题强制同步布局。
* [x] `floating-toc` 相关单元/E2E、desktop 类型检查和必要 lint 通过；Muya 现有测试不回归。
* [x] 记录一次真实/等价长文档的性能指标，并说明测试限制。
* [x] 收起状态当前标题亮蓝，连续向下滚动超过刻度容量后列表跟随，上下往返仍准确。
* [x] 反复展开/收起不使活动刻度跳到顶部；展开期间正文移动后，收起时跟随新位置。
* [x] 折叠分支、目录搜索、窗口缩放不会隐藏收起状态的当前刻度。
* [x] 使用真实鼠标 wheel 事件验证多轮滚动，而不只设置 `scrollTop`；收起滚动热路径不整批重测标题，也不读取刻度行矩形。

## Definition of Done

* 代码、回归测试、必要的规格/验证记录提交。
* 使用隔离 Electron profile 和临时测试文档；不修改用户笔记、安装目录、插件或个人配置。
* 若需打包，先完成源码和测试验证，再单独生成带明确版本号的包；本任务不覆盖现有 GitHub Release。

## Out of Scope

* 不改变标题层级或展开面板布局；允许将固定行高刻度与变高标题列表分别渲染并维护独立滚动位置。
* 不把性能优化做成永久禁用浮动目录，也不删除展开面板的活动标题指示。
* 不修改 HTML 布局编辑器、独立视频插件或播放器逻辑。
* 不为本任务引入 Trellis 以外的运行时依赖。

## Technical Approach

1. 先用现有 Playwright 启动器和临时长文档建立长时基线，记录主线程帧、脚本耗时、观察器回调和布局读取；分别开启/关闭浮动目录。
2. 检查并限制 floatingToc 的 MutationObserver/ResizeObserver 触发条件，避免 characterData、非布局属性或无关子树变化进入全量测量；将布局测量合并到空闲/稳定帧，并在滚动时只做轻量活动项解析。
3. 检查滚动位置持久化的调用频率和序列化成本，必要时将其进一步合并到滚动停止/定时批处理，但保留切换和退出前的可靠保存。
4. 增加长时回归测试和清理断言，运行 desktop/Muya 相关质量检查。

## Technical Notes

* 主要文件：`packages/desktop/src/renderer/src/components/floatingToc/index.vue`、`packages/desktop/src/renderer/src/util/floatingToc.ts`、`packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue`、`packages/desktop/src/renderer/src/store/bufferedState.ts`。
* 现有短时回归：`packages/desktop/test/e2e/floating-toc-scroll-performance.spec.ts`；需要扩展而不是删除它。
* 相关规格：`.trellis/spec/marktext/frontend/index.md`、`.trellis/spec/marktext/frontend/quality-guidelines.md`、`.trellis/spec/core/frontend/pointer-hover.md`、`.trellis/spec/guides/project-boundaries.md`。
## Research References

* [`research/long-scroll-profile.md`](research/long-scroll-profile.md) — long-note profiling, observed floating directory hot paths and proposed optimizations.
