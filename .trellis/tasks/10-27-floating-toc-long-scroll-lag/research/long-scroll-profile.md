# Long-scroll profiling and likely hot paths

## Reproduction setup

* Existing Playwright Electron launcher was used with a synthetic note containing 80 headings and local SVG images, and with the user's available `1.硬件基础-语义比例版/1.硬件基础.md` (308 headings, 547 rendered images, roughly 108 KB rendered scroll height in the test profile).
* The test used a disposable Electron profile and repeatedly changed `.mu-editor.scrollTop` up and down. This does not replace a physical-wheel profile, but it exercises the same scroll event path without modifying the user's note.
* The current short regression test passes and reports no heading `getBoundingClientRect()` reads during the scroll path.

## Findings

1. `floatingToc/index.vue` already moved heading measurement out of the normal scroll handler, but each active update still scans every cached heading from the beginning. The scan is O(number of headings) per animation frame.
2. Each active change calls `keepActiveVisible()`. It queries every TOC row with `querySelectorAll()` and then reads row layout. With hundreds of headings this is unnecessary DOM work and can trigger style/layout synchronization in the expanded panel.
3. The component observes the entire `.mu-editor` subtree with `MutationObserver({ childList: true, subtree: true, characterData: true })`. Character data changes and unrelated editor mutations can enqueue measurement work even when the heading outline did not change. It also observes the scroll container itself with `ResizeObserver`, although scrolling does not change that box.
4. `scheduleMeasure()` currently allows layout measurement to compete with an active scroll frame. Image/resource loads and editor mutations during a wheel gesture can schedule a full all-heading measurement in the next frame.
5. The editor scroll listener calls `updateScrollPosition()` for every scroll event; it is already trailing-debounced before IPC, but each event still mutates the Pinia tab state. This should remain under observation, but the floating TOC path is the confirmed user-correlated suspect and can be isolated first.
6. The first profile on the available headless machine did not show >50 ms frames, so the issue is likely sensitive to compositor/GPU load and/or the user's exact note. It did show full-note startup long tasks and thousands of active-row layout reads over repeated cycles, which are useful regression signals.

## Proposed implementation direction

* Make active-heading lookup binary-search based.
* Keep direct refs for TOC rows so active visibility does not scan/query the entire list on every heading change.
* Add `v-memo` around each row so active-heading changes do not re-patch labels, colors and branch controls for every row.
* Narrow observation: watch content markdown/list outline for edits, observe only content-box resize, filter resource-load events, and remove `characterData` from the full-subtree observer. Defer full heading remeasurement until scrolling has been idle for a short interval.
* Add a long-scroll test with a large local-image document and instrumentation for active-frame work, row layout reads, duplicate connections, and image/layout invalidation.

## Limits

The final judgment must include a real Electron packaged/executable check and should report that the automated profile is a regression signal, not a universal FPS guarantee.
