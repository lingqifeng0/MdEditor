## 0.2.3 开源许可补充

安装包附带 MIT `LICENSE` 与 `NOTICE.md`，保留适用的上游版权及许可声明。延续 0.2.2 的保存提示区高度修复，播放器定位逻辑不变。

# MdEditor 8.31 视频回看插件

独立的 **SDK 2 / API 2** 桌面插件。插件 ID 为 local.video-study，版本为 0.2.3。安装包仍然是 .mtplug，内部是 ZIP，根目录含 manifest.json、main.cjs、settings.html 和插件自己的身份检查程序。

旧版 SDK 1 的 local.video-study-0.1.1.mtplug 使用宿主 ipc.mpv，不能作为 API 2 插件使用。新版不要求修改 MdEditor 主程序、app.asar 或 mpv 配置。

## 0.2.2 设置页修复

保存过程中保留反馈区域高度，默认预留三行，长路径换行时临时保留完整结果高度。避免“正在检查”和“已保存／路径／版本”互换时，推动下方链接说明和外层设置页面上下跳动。保存、检查路径与选择程序共用此逻辑，不增加内部滚动条。宿主业务接口、播放器定位逻辑和原有配置路径保持兼容。

## 安装和使用

1. 在 **MdEditor 8.31 → 插件 → 导入插件包** 中选择 local.video-study-0.2.3.mtplug，更新或安装，启用并授权。更新时保留原有设置。
2. 在 **偏好设置 → 插件** 中打开视频回看的设置，选择真正的 mpvnet.exe 或 mpv.exe，点击 **保存设置**。例如本机的 C:/App/mpvnet-modern/mpvnet.exe。已有有效配置时无需重新选择。
3. 打开已经保存的 Markdown，Ctrl＋点击视频时间戳，或使用 MdEditor 的“打开链接”入口。

示例：

    [00:01:23.250](<../视频.mp4#t=83.250>)

t 的单位为秒，最多三位小数。视频文件路径相对于原始 Markdown 所在目录解析。中文、空格、百分号和 # 可以使用 URI 编码；只解码一次。现有 03–06 补充笔记使用相同格式，可直接使用。

插件只接管本地媒体的 #t= 链接；普通网页链接由 MdEditor 正常打开。无需 localhost 网页、固定 HTTP 端口、Windows 自定义 URL 协议或播放器专用插件。

0.2.1 修复 0.2.0 漏声明 editor.read 的问题。8.31 在缺少此权限时不会向链接回调传递原文档，导致已保存的笔记被误判为未保存。此权限用于读取链接来源笔记的路径；插件不声明 editor.write，也不改写笔记。

此版不再注册编辑区设置命令和 ▶ 按钮，因此不会因视频回看插件出现右上角“插件命令”浮层。设置页统一放在偏好设置的插件区域。

## 设置与迁移

- 播放器在同一磁盘时，保存为相对于 **MdEditor 程序文件夹** 的路径。两款软件一起移动并保持相对位置时继续有效。跨磁盘时使用绝对路径；换环境后可重新选一次程序。
- 视频始终使用相对于 **笔记文件夹** 的路径；迁移笔记和视频时保留它们的相对目录。
- 配置通过公共 ctx.settings 保存于宿主提供的 plugin-data/local.video-study，不写进插件代码。
- 会话通过公共 ctx.storage 保存。通信地址属于本机进程，换环境、播放器退出或身份变化后，插件重新验证并建立连接。
- 兼容旧设置中的 player.base=marktextExecutableDir、player.path 和 afterSeek；迁移仅在读取时解释，选择并保存后使用新结构。不会自动读取其他软件版本的数据目录。
- 启用、选择路径、检查路径、保存设置只准备/检查插件自己的辅助程序；用户打开时间戳时才会启动或控制播放器。
- 停用插件取消未完成请求、关闭 Socket 和插件身份检查程序，保留播放器。

## 通信与行为

插件自己使用 Node child_process 启动播放器，通过 Windows 命名管道连接 [mpv JSON IPC](https://mpv.io/manual/stable/#json-ipc)。启动参数按数组传递，不经过命令行拼接或浏览器。

优先复用本插件已验证的播放器会话。对于当前 mpvnet-modern，也可以尝试已有 \\.\pipe\mpvnet-modern；只有 Windows 查询到的管道所属进程与所选程序一致时才发送 mpv 命令。没有可用连接时，插件创建随机命名管道，并用 --process-instance=multi 启动 mpv.net 的专用回看实例。普通已经打开、没有 IPC 的播放器无法直接连接，首次回看可能创建新实例。

身份检查包含 PID、真实程序路径和进程启动时间。插件内的 native-helper.exe 由 native/NativeHelper.cs 编译，启用时预热并复用；每次点击不会启动 PowerShell 或现场编译。

先确认文件存在、程序身份和协议，再加载/定位。加载需要 file-loaded 与路径确认；定位使用 absolute+exact，等待 playback-restart、seeking=false、路径和时间读回。确认后按设置播放或暂停。快速连续点击时采用最新请求，旧操作停止发送后续命令。链接自带原文档路径，切换标签页不会改变该次请求的基准。

## 源码与构建

全部源码、设置页、公开 SDK 声明、身份检查源码、构建脚本与测试都在本目录；安装包内只有运行所需文件。插件运行不依赖源码项目和开发工具。

构建需要 Windows x64、Node.js、TypeScript、esbuild、Node 类型和 .NET Framework C# 编译器。sdk/index.d.ts 是 MarkText v8.31 公开 SDK 的副本，来源记录于 sdk/README.md。不依赖旧 SDK 的私有播放器接口。

    npm install
    npm run build
    npm test

本机可复用已存在的 MarkText 开发依赖缓存：

    $env:MARKTEXT_SDK_SOURCE = (Resolve-Path '../..').Path
    node scripts/build.cjs
    node --test test/*.test.cjs

输出：

- dist/local.video-study-0.2.3.mtplug：安装包。
- dist/package/：可通过“导入文件夹”安装的解包目录。
- dist/marktext-video-study-sdk2-0.2.3-src.zip：可迁移源码包。
- dist/SHA256.json：安装包与源码包的 SHA256。

测试使用模拟 mpv 的真实命名管道，验证冷启动调度、连接复用、切换文件、快速点击、取消、断连重连、错误身份、文件缺失、设置和生命周期；本机播放器只读取程序版本信息，不进行播放。实际解码画面与回看速度需要用户点击真实时间戳后验收。
