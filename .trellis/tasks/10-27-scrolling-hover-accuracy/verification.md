# Verification — 2026-10-27

## Behavior

The floating directory now stores document-relative heading positions after layout/content changes. Editor scroll events update the active row from `scrollTop` in a lightweight animation frame, so scrolling does not measure every heading. The active row remains correct during repeated downward jumps and the final scroll position. Table hover tools keep real offset hit tests for table edges, but skip redundant probes when the event's actual ancestor path already contains a table cell.

## Checks

| Check | Result |
| --- | --- |
| Muya full Vitest suite | 295 files, 2,637 tests passed (agent run) |
| Muya TypeScript check | Passed |
| Changed Muya ESLint | Passed |
| Desktop Vue TypeScript check | Passed |
| Desktop floating TOC unit suite | 22 passed |
| Floating TOC appearance E2E | 5 passed |
| New floating scroll accuracy/performance E2E | Passed; active rows matched expected headings and heading layout reads stayed at or below 2 during scroll |
| Electron build | `electron-vite build` completed after all source changes |
| Renderer profile on copied image-heavy note | Final `hover-opt-final`: ScriptDuration 0.754 s, frame p95 26.6 ms, 1 frame over 50 ms; previous v8.33 packaged: 0.964 s, p95 26.8 ms, 1 over 50 ms |

The profile is a local reproduction on this machine, not a universal frame-rate guarantee. The strongest regression signal is the removal of the repeated heading `getBoundingClientRect()` calls from the scroll path; the final profile retained only incidental heading reads from startup/layout changes.

## Scope

Only the desktop floating directory and Muya table hover paths changed. No note, installed app, player setting or independent `video-study` plugin was modified. Generated `out/`, profiles, user data and test notes remain outside Git.
