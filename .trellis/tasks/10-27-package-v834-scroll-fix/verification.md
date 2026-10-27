# Verification — 2026-10-27

## Artifacts

Local delivery folder:

`C:\Users\wenyu\Desktop\code\markdown\MarkText-Toolbar\Windows-v8.34`

It contains:

* `MdEditor-win-x64-v8.34-setup.exe` — 127,339,996 bytes
* `MdEditor-win-x64-v8.34.zip` — 184,280,746 bytes, root folder `MdEditor/`
* `local.video-study-0.2.5.mtplug` — 22,770 bytes
* `使用说明.md`
* `SHA256SUMS.txt`

SHA-256 values are recorded in the delivery folder. The portable ZIP passed CRC validation and contains no files under its empty user-data directories.

## Checks

| Check | Result |
| --- | --- |
| `electron-vite build` | Passed |
| Windows x64 electron-builder | Passed; MdEditor.exe, NSIS installer and ZIP generated |
| Packaged manifest | `0.31.0-toolbar.v8.34`, product `MdEditor` |
| Packaged ripgrep runtime | Present under `resources/app.asar.unpacked/node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe` |
| Packaged floating directory E2E | Passed against `dist/win-unpacked/MdEditor.exe` |
| Portable archive | CRC passed; single `MdEditor/` root; no user-data files |
| v8.33 assets | Left untouched |

The v8.34 package is prepared locally. GitHub Release publication is a separate step and was not performed in this packaging task.
