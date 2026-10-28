# Verification — 2026-10-28, v8.36

## Behavior

The floating directory now keeps the scroll path lightweight. Active-heading lookup uses a binary search over cached document coordinates, active rows are retained by element reference, and Vue memoizes rows whose state did not change. Full heading measurement is deferred while a wheel gesture is active and runs after roughly 200 ms of scroll idle time. Mutation observation is limited to structural changes in the content region; the scroll container is no longer observed for resize, and resource invalidation responds only to image loads.

The compact rail again highlights the current heading with the theme color and follows it when there are more chapters than the viewport can display. Compact and expanded lists have separate keyed DOM and independent scroll offsets. Compact visibility uses the cached row index and fixed row height, including padding. An unchanged reading position survives hover cycles; reading changes while expanded follow the new current heading on collapse. Compact strokes retain all headings even when expanded labels are folded or searched. Expanding a short folded list retains the previous rail's hover area to avoid expand/collapse oscillation.

The previous passive-gray contract was incorrect and is superseded by the user's two recordings and the updated PRD. The root-cause and prevention record is [compact-rail-regression.md](research/compact-rail-regression.md).

## Checks

| Check | Result |
| --- | --- |
| Floating TOC unit, label and preference suites | 37 passed |
| Floating TOC scroll-performance E2E against packaged EXE | 7 passed; eight repeated programmatic rounds, 75 actual wheel inputs, theme-colored active markers, overflow in both directions, expanded active-row visibility, four hover cycles, reading changes, folding/search, window resize, late image resize and source/rendered mode transitions |
| Floating TOC appearance/source-color E2E against packaged EXE | 5 passed |
| Document-search and TOC interaction E2E against packaged EXE | 4 passed |
| Packaged save/reopen smoke | 1 passed; HTML text and styles saved and reopened in a fresh disposable profile |
| Desktop Vue typecheck | Passed (`vue-tsc --noEmit -p tsconfig.json`) |
| Changed-file ESLint | 0 errors; four pre-existing non-null assertion warnings |
| Electron renderer build | `electron-vite build` passed |
| Actual-wheel large-note comparison | 308 headings, 547 loaded images; 240 wheel inputs per mode. Compact and disabled modes both had a 26.8 ms frame p95 and one frame over 50 ms |
| Packaged large-note wheel profile | Six down/up cycles, 480 actual wheel inputs, 1,128 sampled frames; p95 26.8 ms, maximum 44.4 ms, zero frames over 50 ms; zero heading rectangle reads, compact-row rectangle reads or full-row queries; no renderer errors |
| Packaged real-note hover check | Heading index 150 and compact scroll offset 1522.2857666015625 preserved before/after expansion; marker fully visible in both cases |
| Windows package inputs | v8.36 manifest; packaged renderer bytes equal the verified build; Windows x64 ripgrep binary present; no source test, Trellis or local validation directories in ASAR |
| Windows build and portable archive | NSIS build exited 0 through pinned pnpm 10.33.4; portable packager verified every archived file byte and CRC; root `MdEditor/`, executable `MdEditor.exe`, no user data copied |

The large-note profiles used actual `mouse.wheel` events on a local validation copy and disposable Electron profiles. Results are local regression signals, not universal FPS guarantees for every GPU, display scale or note. An initial synthetic-wheel probe also saw reads from the existing paragraph hover control; call stacks distinguished those per-reference reads from an entire-outline scan, and the E2E now checks the largest per-frame read batch and zero compact-row rectangle reads.

## Scope

Desktop floating-directory source, tests, version metadata and development records changed. The delivery is `MarkText-Toolbar/Windows-v8.36` beside the repository, with one setup EXE, one portable ZIP, the existing separate video-study 0.2.5 plugin, usage instructions and checksums. User notes, installed applications, plugin code and personal profiles were not edited. Git changes remain in the working tree at the user's request; no GitHub release was changed. Raw profiles and screenshots remain in ignored `validation/floating-toc-20261028/`; temporary Electron profiles were removed.
