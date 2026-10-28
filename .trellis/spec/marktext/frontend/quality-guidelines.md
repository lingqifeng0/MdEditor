# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)

## Scroll-sensitive renderer components

Floating overlays that follow an editor scroll position must keep the scroll event path layout-light and must not turn every scroll frame into a full DOM measurement.

### Contract

* The scroll handler may schedule one `requestAnimationFrame` for lightweight state such as the active heading.
* Cached document coordinates must be invalidated by content/layout changes, image loads and window resize; invalidation during a wheel gesture is deferred until scrolling is idle so a full heading measurement does not compete with the gesture.
* `MutationObserver` should observe only the content region and structural changes that can affect layout. Do not observe `characterData` across the entire scroll container when the renderer already exposes a reactive content revision.
* `ResizeObserver` should observe the content box whose size can change, rather than the scroll container whose `scrollTop` changes do not alter its box.
* Activity-row visibility should use retained element references or a direct lookup. A scroll frame must not query every row or read every heading rectangle.
* The compact rail must highlight the current heading with `--themeColor` at the top, middle and bottom of a document. When its fixed-height rows overflow, scroll only enough to keep the active stroke fully visible; calculate that offset from the row index without measuring row rectangles.
* Compact and expanded lists have independent scroll offsets. Expanding or searching the variable-height labels must not change the compact marker's position. After collapse, preserve the compact offset unless the current heading or viewport changed while expanded.
* Branch folding and directory search apply to expanded labels. The compact rail retains every heading so a collapsed branch cannot remove the current-position stroke.
* Compact navigation colors distinguish at most three positions: active uses `--themeColor`, the real immediate parent uses teal, and the real grandparent uses amber. More distant compact ancestors stay neutral. Resolve relationships through `parentSlug`, including skipped heading levels. Expanded H-level badges use six level colors rather than ancestor state colors. Expanded title text follows the corresponding document heading theme colors and inline HTML colors, including when searched or active. The active row uses one neutral translucent overlay. Keep full ancestor sets for search reveal and folded-row navigation.
* Dark-mode overrides in Vue scoped styles must wrap the complete external selector, for example `:global(body.dark .floating-toc)`. Wrapping only `body.dark` can compile to a body-only rule, leaving the component's own light-theme variables in effect. Verify computed colors in both theme modes.

```ts
const handleScroll = (): void => {
  scrolling = true
  scheduleActive()
  restartScrollIdleTimer()
}

const scheduleMeasure = (): void => {
  if (scrolling) {
    measurePending = true
    return
  }
  if (measureFrame === null) measureFrame = requestAnimationFrame(measure)
}
```

### Regression checks

* Unit-test the active-heading resolver with both small and large sorted position arrays, including the first heading and document bottom.
* Electron E2E must repeat upward/downward scroll cycles and assert that no heading rectangle reads or full-row queries occur in the scroll path.
* Include actual `mouse.wheel` events and more headings than the compact viewport can display. Assert theme-colored active strokes in the middle, overflow following in both directions, four expand/collapse cycles, folding/search, and viewport resize. A gray marker or a missing marker is a failed behavior check even when the performance counters pass.
* Run the appearance test separately when the combined Electron suite is resource-sensitive; a timeout in a screenshot-only case is not evidence of a scroll regression until the case passes in isolation.

### Common mistake

A layout observer that is correct for initial rendering can still make long sessions sluggish when it is attached to the entire editor subtree. Treat observer scope and invalidation timing as part of the component's performance contract.

Do not remove reading-position feedback to satisfy performance counters. The 2026-10-28 regression came from treating a passive gray rail as an acceptable substitute for the requested blue current-heading marker, and from testing that incorrect assumption. Validate behavior and cost together against the user's recording.
