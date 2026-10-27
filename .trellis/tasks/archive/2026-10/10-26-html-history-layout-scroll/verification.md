# Verification — 2026-10-26

## Delivered behavior

The HTML modal owns undo/redo for its draft, including structural actions, text/styles, source input and gestures. Native Edit-menu routing targets the modal while open, including an empty history. Apply still creates the existing single document transaction. Structural removal preserves measured object and frame geometry, including nested image/caption spans. Image-heavy hover reuses the actual mouse target and short-circuits paragraph margin searches.

## Checks

| Check | Result |
| --- | --- |
| Full desktop unit suite | 1,739 passed, 36 existing skips; 119 test files passed, 4 skipped. |
| Engine UI and pointer tests | 251 passed across 25 files. An initial cold package-entry import hit the 5 s timeout under concurrent compilation; the complete run with two workers passed without changing test assertions/timeouts. |
| Desktop/Muya typecheck | Passed. |
| Changed-file desktop and engine lint | Passed; only the pre-existing root eslint config module-type warning remains. |
| Development Electron feature/regression suites | 10 passed, no unexpected/flaky results. |
| Final packaged executable | 6 representative tests passed, including all four history/geometry cases and text add/edit/save/fresh-profile reopen. |
| Real note caption scenario | Passed against the user's copied note and real assets: three images, maximum rectangle/frame deviation 0.0089111328125 CSS px through deletion and Apply/reopen; undo/redo passed. Copy on disk and original input note hash remained unchanged. |
| Package inspection | Final combined v8.32 manifest; no tests, development config or Trellis in app.asar; Windows ripgrep binary and license notices present. |
| Portable archive | CRC and every file's bytes verified; root MdEditor/; no personal user data included. |
| Scope | No independent video-study, main-process or preload code changes. No installed app update or GitHub publication. |

## Same-note scrolling measurement

Windows x64, Electron 42.1.0, isolated equal dark-theme profiles, copied note and 239 original asset files, 65 equivalent mouse/wheel steps. GPU acceleration remains enabled. Raw CPU profiles and measurement JSON are retained under ignored `validation/html-regressions-20261026/`.

| Metric | Earlier v8.32 package | Final combined v8.32 package |
| --- | --- | --- |
| ScriptDuration | 1.988276 s | 0.964 s (rounded) |
| Frame interval p95 | 40.1 ms | 26.8 ms |
| Frame intervals over 50 ms | 13 | 1 |

The old v8.31 comparison reproduced approximately the same pre-fix cost as v8.32. This identifies an existing image-heavy hover hot path rather than proving that text-box controls caused the cost. Measurements are this machine's reproduction, not a universal frame-rate guarantee.

## Artifacts

- Local delivery: `../MarkText-Toolbar/Windows-v8.32-预览/`.
- Archive: final combined v8.32 archive; its checksum is recorded beside the package in the delivery folder.
- Public synthetic screenshot: `docs/assets/screenshots/html-layout-history.png`.
- Private real-note reproduction screenshot/logs remain in local validation/delivery output, outside Git.

## Retained contracts

See the updated desktop HTML layout spec for draft/menu routing, deferred image cleanup, source-preserving geometry and unsupported transforms. See the new core pointer-hover spec for primary target paths, foreground ownership and actual offset hit tests. The real-note fixture and original assets are not part of source commits or the portable ZIP.
