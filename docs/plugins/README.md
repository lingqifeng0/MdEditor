# MdEditor 插件 SDK 2

本目录对应从 **v8.25** 重建的 **Windows v8.31** 通用插件平台。程序版本为 `0.31.0-toolbar.v8.31`，公开 API 版本为 **2**，插件包格式版本为 **2**。程序版本和 SDK 版本分别维护。

API 类型以 [`sdk/index.d.ts`](sdk/index.d.ts) 为准；安装包声明以 [`manifest.schema.json`](manifest.schema.json) 和运行时校验器为准。完整交付位于 `Windows-v8.31/`：软件安装器和便携 ZIP 在最外层，最终验收记录在 `验证记录/`，源码 ZIP 和本开发说明在 `开发资料/`。本文件是新版开发交接入口，旧 v8.29/v8.30 的 SDK 1 文件只能作为历史参考。

便携 ZIP 名称为 `MdEditor-win-x64-0.31.0-toolbar.v8.31.zip`，包内顶层文件夹统一叫 `MdEditor`。解压后从 `MdEditor/MarkTextToolbar.exe` 启动，用户数据和插件目录随这个软件文件夹迁移。

## 1. 已确立的边界

保留 v8.25 的浮动目录、文字/图片工具栏、HTML 布局编辑、图片资产管理、保存与撤销。新增扩展安装为独立插件，宿主只提供通用 SDK。安装或更新一个使用既有 API 的插件，不能修改 EXE、`resources/app.asar` 或主程序源码。

原生回归发现基础图片功能中的保存/关闭竞态：新图片选择“只删除链接”后，正文可能与已保存版本相同，关闭操作会早于异步保存及图片提交。v8.31 让磁盘保存与图片提交共用资产记录，关闭清理等待该写入完成；失败则保留资产并阻止该清理。此修复属于 v8.25 编辑器内置图片功能，与插件业务无关。

视频插件自行负责链接解析、播放器设置、启动参数、进程身份检查、Windows 辅助程序、JSON IPC、连接复用、预热、重试、加载、定位、取消和清理。新版 SDK 没有播放器通信接口或播放器默认设置。

接口的模块组织参照 Obsidian。MarkText 使用 Muya 和跨进程接口，现成 Obsidian 插件需要适配，不承诺直接兼容。

## 2. 程序、代码、设置的位置

便携程序根据实际 EXE 位置计算路径：

```text
MdEditor/
├─ MarkTextToolbar.exe
├─ resources/app.asar
└─ marktext-user-data/
   ├─ plugins/
   │  └─ local.example/
   │     ├─ manifest.json
   │     ├─ main.cjs
   │     ├─ view.html
   │     └─ helper.cjs
   └─ plugin-data/
      └─ local.example/
         ├─ settings.json
         └─ 自己的数据文件
```

`ctx.app.paths.code` 是当前插件程序目录，`data` 是当前插件数据目录，`application` 是软件所在目录，`userData` 是当前用户数据目录。路径由运行位置决定，不能写死盘符。开发运行支持显式 `--user-data-dir`；验证使用独立配置目录，不读写现用配置。

更新只替换 `plugins/<id>`。卸载默认保留 `plugin-data/<id>`，停用不清除设置。不要将设置写进插件程序目录，也不要把 `node_modules` 开发缓存放入迁移包。

## 3. 安装包和入口

`.mtplug` 是普通 ZIP，`manifest.json` 位于包根目录。根目录无需套一个插件 ID 文件夹。包内不能包含符号链接、目录联接、越界路径或 Windows 大小写冲突名称。支持导入包、导入目录和拖入包/目录；安装后默认停用，由用户启用。

```json
{
  "formatVersion": 2,
  "apiVersion": 2,
  "id": "local.example",
  "name": "独立插件示例",
  "version": "0.1.0",
  "main": "main.cjs",
  "permissions": ["editor.read", "ui"],
  "isDesktopOnly": true
}
```

### 插件版本声明与显示必需要求

所有插件都必须声明并显示自己的发布版本，不只适用于视频回看。`manifest.version` 必填，例如 `0.2.1`；缺失、空值或不符合当前 schema 的格式会被拒绝安装或加载。插件版本、MarkText 程序版本、`apiVersion` 和 `formatVersion` 分别维护。

插件管理卡片在名称旁显示已安装版本，停用后仍可查看。插件自己的设置页页头也必须显示名称和已安装版本，例如“视频回看 0.2.1”。安装确认显示待安装版本，更新确认同时显示当前版本和新版本；更新成功或失败回退后，界面和启动记录必须对应实际使用的版本。

版本显示以当前已安装插件的 `manifest.version` 为准，不根据包名猜测，不在 HTML 中写死。插件自绘界面如需显示版本，在插件进程使用公开的 `ctx.manifest.version`，通过自己的视图消息传入 HTML；不要读取宿主私有对象。已发布插件修改功能或修复问题时必须更新版本号，交付包名、声明和开发说明标明同一发布版本。

验收检查：版本缺失/格式无效、首次安装、停用查看、独立设置页、更新成功和更新失败回退。v8.31 当前已实现版本校验、管理卡片版本显示、安装/更新的新版本提示以及启动版本记录；设置页通用页头的版本显示、更新确认的旧/新版本对照是新增必需要求，尚未随本次文档更新实现。

`main.cjs` 导出 `activate(ctx)`，可选导出 `deactivate()`。插件开启时初始化；不要把长时间的播放器操作放在 `activate()` 中阻塞加载。初始化超时或抛错会移除注册，显示插件错误。

```ts
import type { PluginContext } from '@marktext/plugin-sdk'

export async function activate(ctx: PluginContext) {
  await ctx.commands.register({
    id: 'hello',
    name: '插件问候',
    callback: ({ windowId }) => ctx.ui.notice('你好', windowId)
  })
}
```

注册 ID 在本插件范围内唯一，同一 ID 可以分属不同注册类型。宿主按插件 ID 隔离注册，不要求每个按钮名称重复完整插件命名空间。

SDK 1 插件会收到明确的不兼容提示。新平台不自动加载旧格式，也不通过保留宿主播放器代码来兼容旧插件。

## 4. 运行和生命周期

每个启用插件有独立的 Electron utility process，可以使用 Node.js。编辑器 renderer 保持 `contextIsolation`、`sandbox` 和关闭 Node integration。插件的界面在独立的 opaque-origin iframe 中运行，只能通过公开视图桥接通信。

桌面 Node 插件是用户信任的本地程序；独立进程用于隔离故障，manifest 权限约束宿主 SDK 的调用，不是操作系统级沙箱。原生 Node 文件和进程访问由插件负责。插件不能因为能使用 Node 就依赖宿主内部文件、Vue、Muya 或修改程序文件。

`ctx.register(resource)` 可以登记 `Disposable` 或清理函数。命令、事件、视图、按钮、渲染器和设置入口由 SDK 自动登记。停用移除宿主入口，触发取消信号，再运行 `deactivate()` 和清理函数；超时后结束插件进程。

插件自行释放原生计时器、Socket、readline、worker 和辅助进程。直接启动的 Node 子进程没有自动资源归属，必须显式登记。播放器是否保持运行由插件决定，停止播放器通信与关闭用户播放器是两个分别处理的动作。发生强制终止时，不能承诺任意原生子进程已经被操作系统回收。

```ts
const child = spawn(process.execPath, ['helper.cjs'], { windowsHide: true })
ctx.register(() => {
  child.stdin?.end()
  child.kill()
})
```

更新采用暂存和回退。启用中的插件更新后重新激活；激活失败会恢复原插件程序。插件自身的设置迁移应先读取旧值、验证新结构，再保存；不要在激活验证前破坏旧数据。

## 5. 当前接口及限制

| 模块 | 当前公开操作 | 调用语义 |
| --- | --- | --- |
| App / Plugin | `manifest`、`app`、`signal`、`register` | API/能力信息、运行路径和资源归属；不用宿主内部全局对象 |
| Commands | `register`、`execute` | 独立插件命令列表、按钮入口、窗口快捷键；命令获得窗口与文档快照 |
| Workspace | `getActiveDocument`、`listDocuments`、`openFile`、`createDocument` | 打开文件或建立未保存标签页；文档上下文有明确 ID |
| Editor | `getDocument`、`edit`、`setSelection`、`undo`、`redo` | UTF-16 Markdown 偏移、版本化原子事务；WYSIWYG 和源码模式使用同一接口 |
| Metadata | `get` | 当前支持 ATX 标题和简单行内 Markdown 链接/图片，跳过 fenced code；不声称提供全部 CommonMark AST、HTML 属性或 YAML 索引 |
| Files | `resolve`、`readText`、`readBinary`、`list`、`stat`、`writeText`、`createFolder`、`trash` | 默认范围为打开文档所在目录、插件代码/数据和用户选择的文件/目录；按实际路径验证；打开的文档不能直接写磁盘 |
| Events / Links | `events.on`、`links.register` | 文档/活动文档/设置/明暗主题事件、原始链接和原文档上下文；链接语法由插件定义 |
| UI | `registerView`、`openView`、`closeView`、`registerButton`、`notice`、`dialog` | 侧栏、插件页、底部面板、对话框和设置视图；位置对应插件视图容器，不是私有编辑 DOM |
| Settings | `register`、`read`、`save` | 插件定义的普通字段或完整 HTML 设置页，启用后出现 |
| Storage | `get`、`set`、`remove` | 本插件 JSON 存储，原子替换；自己的数据结构及迁移由插件维护 |
| Markdown | `render`、`registerCodeBlock` | 公共 Markdown 渲染结果中的自定义代码块处理，输出经过清理；不修改 Muya 块模型或提供 CodeMirror 私有扩展 |
| Desktop | `chooseFile`、`openExternal`、`revealFile`、剪贴板文字 | 宿主提供通用桌面动作；启动/通信/身份检查通过插件自己的 Node 代码实现 |
| Network | `request` | HTTP(S)、取消和大小限制，插件进程本地执行 |
| Log | `info`、`warn`、`error` | 按插件持久化的日志，管理页可查看；避免记录秘密或大块正文 |

`theme-changed` 在启用后发送当前明暗状态，并随应用的明暗主题变化发送 `{ dark }`。插件负责根据该事件更新自己视图的样式。附件/图片的高级编辑接口、完整结构索引、私有编辑器装饰与主题控件扩展不在当前实现中。后续扩展需要通用契约及独立验证。

按钮可选择插件工具栏或底部状态栏；插件页拥有独立标题和关闭入口。此 API 不把插件视图变成普通 Markdown 文件，也不让插件控制现有内置图片工具栏。通用弹窗和文件选择等待用户操作，插件停用时取消尚未结束的 SDK 请求；链接认领回调须在 2 秒内返回，初始化须在 15 秒内结束。

权限名：`editor.read`、`editor.write`、`files.read`、`files.write`、`ui`、`links`、`desktop`、`network`。本插件存储不需要额外文件权限。原生 Node 能力不能依赖这些名称宣称被完全隔离。

链接接口当前从内置编辑器传递 `href` 和文档快照，不承诺提供真实键盘事件：`text` 可能没有值，`modifiers` 的四个字段默认 `false`。不要用这些默认值判断用户是否按了 Ctrl 等键；插件自己的视图可以读取其本地交互事件。识别视频链接只使用原始 `href` 和原文档路径。

## 6. 编辑事务和视口

`DocumentSnapshot` 带 `id`、`windowId`、`revision`、规范化 Markdown、选区、路径、脏状态和当前模式。偏移是 JavaScript UTF-16 code unit 数，范围 `[from, to)`；不是 UTF-8 字节或画面上去除 Markdown 标记后的字符位置。

使用同一次读取的文档和版本。处理结果回来后如果版本已经改变，事务报 `STALE_DOCUMENT`。目标关闭报 `NOT_FOUND`，目标存在但不是该窗口当前编辑文档报 `DOCUMENT_INACTIVE`。不能为了继续操作而把旧目标替换为新的活动标签页。

```ts
const doc = await ctx.workspace.getActiveDocument()
if (!doc?.selection) return
const from = Math.min(doc.selection.anchor, doc.selection.head)
const to = Math.max(doc.selection.anchor, doc.selection.head)
await ctx.editor.edit({
  documentId: doc.id,
  expectedRevision: doc.revision,
  changes: [{ from, to, text: doc.markdown.slice(from, to).toUpperCase() }],
  selection: { anchor: from, head: to },
  viewport: 'preserve'
})
```

事务的范围不得重叠，一次成功事务形成一个撤销单元。默认保留视口；明确导航才使用 `reveal-selection` 或 `setSelection(..., true)`。文本删除导致文档变短时，浏览器可能将滚动位置限制到剩余内容的最大高度，这属于文档几何变化。

默认事务选区沿用原 Markdown 偏移并限制在新文本长度以内；替换长度变化时插件应提供自己的新选区。公开 API 不暴露 Muya 选区树或 CodeMirror 实例。

不要通过 `files.writeText` 修改正在打开的笔记，不要直接往笔记 `assets` 中写临时粘贴图片。v8.25 的保存/不保存和图片资产日志仍由宿主管理；新版 SDK 尚未开放附件事务。

## 7. 插件自己的设置和视图

偏好设置左侧的“插件”位于“快捷键”下方，使用拼图图标。管理列表只显示插件信息及操作按钮；点击插件卡片的“设置”，才打开该插件自己的独立设置页。启用并注册设置后，左侧“已安装插件的设置”也显示它的入口。插件停用时撤销入口和设置视图，不为了打开设置而暗中启动插件；重新启用后可以读取原有设置。

简单设置用 `settings.register` 注册字段：文字、文件路径文字、数字、开关、选择项。字段名称、默认值和校验规则均由插件提供。自定义界面使用 `placement: 'settings'` 的视图，然后把 `viewId` 注册到设置页面。

插件设置页直接铺在偏好设置正文中，没有宿主卡片外框。宿主自动按自定义 HTML 的实际内容高度展开；内容更新或宽度改变时重新测量，较长页面使用偏好设置正文的滚动条。插件无需调用额外的高度接口。视图仍保留独立来源和脚本隔离；侧栏、底部、标签与对话框视图沿用各自容器尺寸。

`ViewDefinition.html` 指向包内 HTML。当前视图使用 CSP 禁止网络、文件 URL、表单导航和直接访问宿主；HTML 内的样式和脚本可以内联。把构建后的 JavaScript/CSS 内联到该 HTML，不要引用外部脚本路径。远程请求在插件进程通过 SDK 执行，再用视图消息返回结果。

HTML 使用 `window.marktextView.request(json)` 向插件的 `onMessage` 发请求，使用 `onData(callback)` 接收 `openView` 的初始数据。回调返回 JSON；DOM、函数、Socket、Buffer 对象不要作为视图协议对象传递。

```ts
await ctx.ui.registerView(
  { id: 'settings', title: '我的插件设置', placement: 'settings', html: 'settings.html' },
  async (message, context) => {
    // 在这里校验插件自己定义的消息，并使用公开 SDK。
    return await ctx.settings.read()
  }
)
await ctx.settings.register({ id: 'advanced', title: '高级设置', viewId: 'settings' })
```

不同视图的 iframe 身份分别验证，插件停用后旧视图请求不能继续调用已移除的入口。不要访问 `parent.document`、`parent.electron` 或私有组件实例。

插件日志通过管理卡片的“查看日志”打开，展开期间自动刷新，也可以手动刷新。`ctx.log.info/warn/error`、插件进程的 `console.log/error` 以及宿主记录的通用启动、停用和错误都写入 `ctx.app.paths.data/logs/marktext.log`。日志只保留最近 128 KiB，过长消息会截断；时间戳为带 `Z` 的 UTC 时间。日志按插件隔离，停用或重启后仍保留，卸载保留插件数据。此通用日志功能不提供任何播放器检查或通信实现。

## 8. 视频回看插件给另一位 AI 的任务

**此次宿主重建不直接开发新的视频业务插件。** 开发者应使用 SDK 2，交付一个独立 `.mtplug`，不要求修改 MarkText 源码或 app.asar。

1. 插件自己注册“视频回看”设置页，设置播放器可执行文件、相对路径基准和行为。文件选择用通用 `desktop.chooseFile`；相对路径的解析与验证在插件内完成。
2. 使用 `links.register` 检查原始 Markdown 链接。插件解释现有视频时间戳格式，使用链接自带的原文档路径解析视频文件。宿主没有视频专用链接种类。
3. 识别后尽快返回 `true` 表示由插件接管；不要等待启动或解码才返回。未识别的链接返回 `false`，由宿主照常处理。链接识别回调有约 2 秒响应上限，后续操作独立运行并报告结果。
4. Node `child_process` 的启动参数用数组传递，Windows 辅助进程使用 `windowsHide: true`。插件自行校验可执行文件、目标 PID、通信地址、实际播放器身份以及视频存在性。
5. `node:net` 连接播放器已有 JSON IPC。协议、命令和状态检查全部在插件包内。播放器身份查询如果需要 Windows 辅助程序，应把程序或源码放入插件包，启动、预热、复用、退出也由插件负责。
6. 启用插件时可以准备自己的通信资源；播放器只在用户点击回看等明确操作后打开。复用现有连接和辅助进程，避免每次点击启动 PowerShell、编译查询代码或等待无效轮询。
7. 快速重复点击时用插件自己的操作编号和取消逻辑处理，旧请求不能覆盖新请求；文档切换不会改变已经识别链接的原始视频路径。
8. 插件自己的设置升级和旧数据迁移需要验证。不要让旧 SDK 1 的安装包、权限名或宿主 `ipc.mpv` 成为新插件依赖。
9. 错误通过通用通知/插件面板显示，由插件给出播放器配置、文件缺失、连接失败或身份不符等具体原因。
10. 默认停用时停止请求、关闭 Socket 和辅助进程，保留用户已打开的播放器；若插件提供其他策略，必须在自己的设置中说明。

必须实测播放器关闭、已打开同一视频、切换视频、连续点击、播放器重启、文件缺失、错误播放器和停用。速度目标为指定本地条件下约 1 秒内看到正确解码画面，记录各次测量和最大值；不能把“命令已发出”当成“视频已显示”。主程序和独立桌面示例的耗时不代表视频插件性能。

插件安装/更新前后计算同一宿主 EXE 和 app.asar 的 SHA256，证明业务迭代只改插件。若认为需要新 API，先说明通用能力缺口与其他插件用途，再进行版本化平台扩展。

## 9. 示例、构建和验证

`plugins/text-tools` 演示编辑事务，`plugins/ui-example` 演示界面和设置，`plugins/desktop-example` 演示插件自己拥有的辅助进程。第三个只是桌面能力验证，没有播放器逻辑。

```powershell
node scripts/build-platform-plugins.cjs
node packages/desktop/node_modules/typescript/bin/tsc -p plugins/tsconfig.json
node test-platform-v2.cjs
node scripts/verify-plugin-platform-v2.cjs
node scripts/verify-platform-asar.cjs
node scripts/verify-portable-paths.cjs
# 对打包程序验证原有编辑功能：
$env:MARKTEXT_TEST_EXECUTABLE = '实际 v8.31 测试程序路径\MarkTextToolbar.exe'
$env:MARKTEXT_TEST_OUTPUT = '../validation'
node scripts/verify-v825-features.cjs
```

构建脚本生成独立 SDK 声明/运行库和三个 `.mtplug`。类型测试包含旧播放器接口不存在、事务缺少版本、字段默认值类型错误和 SDK 1 格式不兼容的反例。运行测试使用独立配置并验证安装、启停、界面、设置、更新/回退与宿主字节。

`verify-portable-paths.cjs` 默认只在测试程序的默认配置不存在时运行；验证便携 ZIP 的预建空目录时，可以显式设置 `MARKTEXT_TEST_ALLOW_EMPTY_PLUGIN_DIRECTORIES=1`，但路径必须位于重建工作区内，而且只允许两个严格为空的插件目录。测试完把本次生成的空配置移入内部 `validation/`，拒绝触碰已有配置。菜单入口测试点击实际渲染器的 ☰，检查收到的原生菜单对象，再执行其“偏好设置”动作；没有自动化 Windows 鼠标选择原生菜单。拖入导入测试通过真实文件支持的 DOM 拖拽事件运行，文件夹导入测试模拟本机文件选择；这不是 Windows 鼠标拖动动作的自动化。图片回归的剪贴板和文件选择使用测试数据，不读写系统剪贴板。交付文件夹的验收摘要和逐项 JSON 在 `Windows-v8.31/验证记录/`，源码包排除依赖缓存及临时测试配置。

当前开发环境只复用项目已有的第三方依赖缓存；renderer 的 Muya alias 明确指向重建目录的 **v8.25 引擎**。开发缓存目录联接不进入源码包或交付软件，也不能据此把 v8.30 的主程序当作基线。

参考：[Obsidian 公共 API](https://github.com/obsidianmd/obsidian-api)、[生命周期](https://docs.obsidian.md/plugins/guides/lifecycle-management)、[Manifest](https://docs.obsidian.md/Reference/Manifest)、[声明式与自定义设置](https://docs.obsidian.md/plugins/guides/migrate-declarative-settings)。
