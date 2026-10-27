# 打包 v8.34 滚动修复预览

## Goal

将已经提交并验证的滚动性能与悬浮目录定位修复打包为 Windows x64 v8.34 预览，生成安装程序、便携 ZIP、独立使用说明和 SHA-256 校验文件；不覆盖 v8.33 资产。

## Requirements

* 版本号使用 `0.31.0-toolbar.v8.34`。
* 打包内容包含 MdEditor Windows x64 安装包和便携 ZIP。
* 便携包根目录为 `MdEditor/`，不包含用户笔记、验证 profile、依赖缓存或 Trellis 文件。
* 在打包后的可执行文件上运行启动、打开长笔记、连续向下滚动和悬浮目录 active 指示回归检查。
* 保留独立 `local.video-study-0.2.5.mtplug`，不修改插件代码。

## Acceptance Criteria

* [x] 版本、安装包、便携包、说明和 SHA-256 文件全部生成。
* [x] 打包后的程序能启动，ripgrep 运行时存在，滚动/悬浮目录回归通过。
* [x] v8.33 现有 GitHub 资产不被覆盖。

## Technical Notes

* 使用 `packages/desktop` 的 Windows x64 electron-builder 配置和 `scripts/package-portable.py`。
* 只提交版本号/发布说明等必要源文件；生成的安装包和 ZIP 留在本地交付目录，按用户后续要求再发布 GitHub Release。
