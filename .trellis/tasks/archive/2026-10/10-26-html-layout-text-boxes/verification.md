# Verification — 2026-10-26

## Result

Implemented whole-box font size and color as confirmed by the user. The right sidebar can create and delete text objects, while retaining the existing source-preserving draft and document transaction paths. No new runtime dependency or plugin API is required. Independent video-study plugin 0.2.5, main-process player behavior and preload contracts are unchanged.

| Check | Result |
| --- | --- |
| Desktop unit suite | 1,731 passed; 36 existing skips across 121 files. |
| HTML layout subset | 358 passed across 7 files, including 17 new source-helper cases. This subset overlaps the full suite. |
| Full workspace typecheck | Passed Muya declaration generation and desktop `vue-tsc`. |
| Changed TypeScript/Vue/test files ESLint | Passed; only the existing root config module-type warning remains. |
| Real Electron feature tests | 6 passed, 0 unexpected or flaky. |
| Final packaged executable | 2 representative tests passed: add/edit/font/color/drag/Apply, and save/reload using a fresh profile. |
| v8.32 build and Windows x64 packaging | Passed with Electron 42.1.0 and pinned pnpm 10.33.4. |
| Packaged archive inspection | Correct v8.32 manifest; no tests, test results, Trellis or development configuration; required Windows ripgrep executable and license notices present. Packaged ripgrep also runs successfully. |
| Portable ZIP | CRC and every archived file's bytes verified by `scripts/package-portable.py`; no user data copied. |
| Scope and whitespace | `git diff --check` passed; independent plugin, main and preload source unchanged. |

## Interaction coverage

The six Electron cases cover selection/focus after insertion, live whole-box size/color, dragging, native text paste, source-mode round trips, intentionally empty and multiline boxes, exact deletion, Cancel, an existing important color, one-step undo and saving/reopening with a fresh application profile. They use generated notes/images and disposable profiles, not installed applications or user notes. Existing HTML layout source tests cover image edits, preservation and bounds.

The full repository's unrelated end-to-end suites were not rerun. The new interaction suite, existing HTML unit subset and complete desktop unit suite were run at the scope relevant to this change.

## Review artifacts

- Actual final packaged-window screenshot: `docs/assets/screenshots/html-text-boxes.png`.
- Local validation logs and JSON reports: `validation/html-text-boxes-20261026/` (ignored by Git).
- Local delivery directory adjacent to the old v8.31 delivery: `../MarkText-Toolbar/Windows-v8.32/`.
- Archive: `MdEditor-win-x64-v8.32.zip`; root `MdEditor/`.
- SHA-256: `26eeeeda57156a25f560e2971d2135af402e45bc0adec6f0c9c52970565f30b7`.

This is a local v8.32 package, with no GitHub push or release publication and no automatic installation into the user's existing app.

## Findings retained in specs

- Font inputs need a live `input` path as well as normalized `change`; relying on Tab/blur alone failed a real UI check.
- Text newlines must be encoded in saved HTML so blank lines cannot split a CommonMark HTML block. A persistent marker retains empty new text targets.
- JSDOM's duplicate important-color parsing differs from Chromium; assert preserved source in units and computed saved color in the actual app.
- Hidden-window screenshots and unfocused native save shortcuts need the test harness handling described in `spec/marktext/frontend/html-layout.md`.
- The first packaged check exposed a missing Windows optional ripgrep module when the builder selected the npm collector. Invoking through pnpm includes the installed platform binary. Positive package globs and explicit dependency test/config exclusions also remove development artifacts. See `spec/guides/windows-packaging.md`.
