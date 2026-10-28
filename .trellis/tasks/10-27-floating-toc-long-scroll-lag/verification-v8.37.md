# Verification — 2026-10-28, v8.37 hierarchy colors

## Approved behavior

The user approved the three-level example, swapped the parent and grandparent colors, and requested implementation. The compact active heading retains `--themeColor`; the immediate parent is teal (`#65c6a3` in dark themes), the grandparent is amber (`#e8b45a`), and more distant ancestors are neutral. Light themes use `#237c60` and `#946200` respectively. Expanded H-level badges use the same states while source HTML title colors are preserved.

The two relationships come from `entriesBySlug` and actual `parentSlug` links. They do not assume consecutive Markdown levels. Full ancestor traversal remains available for search reveal and collapsed-branch navigation. No geometry, scroll following, list restoration or layout-observer behavior was changed for this palette update.

## Checks

| Check | Result |
| --- | --- |
| Floating TOC unit/label/preference suites | 39 passed; includes complete H1–H6, skipped levels, root/missing headings and removed ancestors |
| Packaged hierarchy-color E2E | 4 passed; exact dark/light colors, H6 parent/grandparent, neutral distant ancestors, updated hierarchy, source-mode transition and source HTML color preservation |
| Packaged floating-directory appearance E2E | 5 passed |
| Packaged scroll-performance E2E | 7 passed; includes overflow, hover cycles, real wheel events, late image resizing and source-mode positioning |
| Packaged document-search/TOC E2E | 4 passed |
| Packaged save/reopen smoke | 1 passed with a fresh disposable application profile |
| Total packaged UI checks | 21 passed |
| Desktop typecheck | `vue-tsc --noEmit -p tsconfig.json` passed |
| Changed-file lint | 0 errors; existing non-null assertion warnings remain in older test/helper lines |
| Renderer build | `electron-vite build` passed |
| NSIS build | Pinned pnpm 10.33.4 collector; builder exited 0 |
| Package inputs | Manifest is `0.31.0-toolbar.v8.37`, verified compiled renderer bytes match ASAR, Windows x64 ripgrep binary exists, no source tests/Trellis/local validation output in ASAR |

An initial UI run caught light-theme palette variables being used in dark mode. The cause was partial `:global(body.dark)` scoping in the Vue stylesheet, which compiled to a body-only selector. Wrapping the complete selector as `:global(body.dark .floating-toc)` corrected the override. Both exact-color theme tests passed afterward. The frontend quality spec records this constraint.

## Packaged large-note wheel probe

The actual v8.37 executable opened a local validation copy with 308 headings, 547 loaded rendered images and 149,235 px of content. Six down/up cycles generated 480 wheel inputs and 1,098 sampled frames. Frame p95 was 26.8 ms, maximum 64.3 ms, with one frame above 50 ms. There were zero heading rectangle reads, compact-row rectangle reads or full-row queries in the probe, and zero renderer errors.

The real-note hover check preserved heading index 150 and compact scroll offset 1522.2857666015625. Parent and grandparent strokes were exactly `rgb(101, 198, 163)` and `rgb(232, 180, 90)` before and after expansion. Both markers remained correctly associated with the reading position. These are local regression measurements, not a universal FPS guarantee.

Raw results and screenshots are kept in ignored `validation/floating-toc-v8.37/`. All Electron profiles and documents used for verification were disposable or local validation copies.

## Delivery and scope

The delivery folder is `E:/Jameson/code/markdown/MarkText-Toolbar/Windows-v8.37`, with one setup EXE, one portable ZIP, the separate unchanged video-study 0.2.5 package, usage instructions and SHA256 checksums. The portable packager validates CRC and file bytes and uses `MdEditor/` as the archive root. Earlier versions are preserved.

The change is confined to desktop floating-directory behavior, tests, version metadata and development documentation. User notes, installed applications, plugin code and personal profiles were not edited. Source changes remain uncommitted at the user's prior request, and no GitHub release was changed.
