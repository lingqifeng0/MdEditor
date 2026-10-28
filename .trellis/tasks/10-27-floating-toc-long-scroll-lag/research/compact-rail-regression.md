# Compact reading-position regression — 2026-10-28

## Evidence and corrected requirement

The user's first recording (`SnowShot_Video_2026-10-27_22-39-20.mp4`, 23.8 s) shows a gray rail with no persistent current-heading feedback in the middle of the note. The second recording (`SnowShot_Video_2026-10-27_22-42-54.mp4`, 34.3 s) shows the intended behavior: a theme-colored current-heading stroke advances down the rail, and the rail scrolls once its viewport is full.

Removing that feedback was not an authorized performance tradeoff. The earlier PRD assumption and its neutral-color test encoded an incorrect requirement; they are superseded by the updated PRD and regression tests.

## Root causes

1. **Implicit assumption / missing behavior check:** the prior fix made the compact rail passive and deliberately colored its active stroke gray. Performance-only checks passed while the reading-position behavior was lost.
2. **Shared scroll geometry:** one list was reused for 15 px compact rows and variable-height expanded labels. Browser scroll clamping/anchoring and restoration across different layouts could move the compact marker to an unrelated position.
3. **Incomplete scope:** expanded branch folding also removed compact strokes, so an active descendant could have no active stroke at all.
4. **Hover-area feedback:** keeping all compact chapters while folding expanded labels can shrink the expanded panel below the pointer. That causes immediate mouseleave/collapse and repeated expansion. Preserve the previous rail's hover height, capped by the available viewport.
5. **Reference lifecycle:** disconnecting editor observers must not clear references to expanded rows that are still mounted. Row refs are removed by Vue on unmount and cleared at component teardown.

## Implementation contract

* Use separate keyed compact and expanded lists. Their scroll offsets are independent, and only the active mode is mounted.
* Compact rows render the complete heading outline. Their height and vertical padding share constants with the visibility calculation.
* Resolve the current heading by binary search over cached document coordinates. Keep the current compact row visible using its cached index, row height and viewport height; do not read row rectangles or query the entire rail during wheel scrolling.
* A hover cycle preserves the compact offset when the document stays in the same chapter. If the document moves while expanded, keep the newly active chapter visible on collapse.
* Retain cached heading measurement and layout invalidation after image/content changes. Defer whole-outline measurement during an ongoing wheel gesture.

## Regression coverage

The Electron tests cover top/middle/bottom blue strokes, more rows than the compact viewport, overflow in both directions, four hover cycles, reading changes while expanded, window resize, folded/search-filtered labels, expanded active-row visibility, and 75 real wheel inputs. The existing eight repeated programmatic scroll rounds remain.

An actual-wheel probe initially reported 78 heading rectangle reads. Recorded call stacks traced these to the existing paragraph hover control (`ParagraphFrontButton.show` / Floating UI), not an outline scan. The regression therefore checks the maximum heading reads in a single frame (a full 81-heading scan fails) and asserts zero compact row rectangle reads. It does not remove the editor hover feature to satisfy an unrelated zero-total-read assumption.

## Large-note comparison

A local validation copy has 308 headings, 547 loaded rendered images and approximately 149,235 px of scrollable content at the test window size. Each mode receives 240 actual wheel inputs over three down/up cycles. On this machine the compact and disabled modes both had a 26.8 ms frame p95 and one frame over 50 ms. Compact mode made zero heading rectangle reads, zero compact-row rectangle reads, and zero full-row queries during the probe. These are local regression measurements, not a universal FPS guarantee.

Raw output and the diagnostic script remain in ignored `validation/floating-toc-20261028/`. No user note, installed application, plugin, or user profile is edited. Per the user's existing instruction, changes remain uncommitted.

## Prevention and wider review

| Priority | Mechanism | Completed action |
| --- | --- | --- |
| P0 | Requirement contract | Replace the passive-gray assumption with the user's current-heading and overflow-following requirement in the PRD and frontend quality spec. |
| P0 | Behavioral regression | Assert exact theme color, visibility, current-heading identity and hover stability as well as layout-read counts. |
| P1 | Architecture | Keep compact fixed geometry and expanded variable geometry in independent lists; retain mounted row refs across observer reconnection. |
| P1 | Real input coverage | Exercise actual wheel events, large loaded images, late image resizing and source/rendered mode transitions. |
| P1 | Delivery verification | Run UI and save/reopen checks against the packaged executable, and compare its renderer bytes with the verified build. |

This is primarily an implicit-assumption error (category E) combined with a behavior-test gap (category D), rather than a player/plugin boundary issue. A fast but incorrect current-position indicator must fail review. The same review principle applies to minimaps, progress indicators and outline selection: cost counters cannot replace the feature's observable navigation contract.

The updated frontend spec and the corrected PRD are the durable knowledge record. This repository has no `src/templates/markdown/spec/` mirror to sync. No commit is made because the user previously requested working-tree-only changes.
