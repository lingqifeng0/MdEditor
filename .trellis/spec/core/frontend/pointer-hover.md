# Pointer hover contract

## Scope and trigger

Preview, paragraph and table controls share mouse hover work. Image-heavy notes expose the cost of repeatedly asking Chromium to hit-test the same pointer position. Profile the actual renderer and compare equal notes/profiles before attributing a regression to an unrelated modal feature.

## Signature

`pointerElements(event: MouseEvent, offsetX = 0, offsetY = 0): Element[]` in `src/utils/pointerHitTest.ts`.

## Contracts

- At the event's actual coordinate, return the connected event target and its ancestors, nearest first. The browser has already resolved which foreground element received the mouse.
- Nonzero coordinate offsets still use the owning document's real `elementsFromPoint`. A target's bounding rectangle cannot prove which element occupies a neighboring coordinate.
- If a deferred event's target was removed, recheck its current coordinate rather than retaining a detached block.
- Paragraph tools first search the primary path, and only probe their margin if no outer block was found. Table tools likewise skip their above/below/left edge probes when the primary path already contains a table cell; preserve the real offset hit test for the actual edge case and keep the toolbar-overhang guard.
- Add no document-edit side effects, global pointer listeners or long-lived DOM caches to this helper.

## Validation and cases

| Case | Required result |
| --- | --- |
| Pointer on image inside HTML preview | Resolve ancestors without another native hit test at that point. |
| Pointer over foreground modal/float | Respect its actual ancestor path; do not expose a background block through it. |
| Probe above/below/left of a cell | Call native hit testing at the exact offset coordinate. |
| Removed deferred target | Fall back to current coordinate hit testing. |
| Existing block found at pointer | Do not perform the paragraph margin probe. |

## Required tests

`pointerHitTest.spec.ts` asserts native call avoidance, foreground overlay ownership, offset coordinates and disconnected target fallback. Existing preview toolbar tests dispatch to actual preview nodes and exercise edit/delete/source behavior. Run the engine UI tests and a real Electron HTML-toolbar check after changing hover routing. Performance measurements must use disposable profiles and copied note assets; retain raw local profiles outside Git.

## Wrong and correct

Wrong: each hover tool independently scans the full document at the exact same mouse coordinate, including while scrolling across large images.

Correct: reuse the event's actual target path for primary lookup, short-circuit successful searches, and keep coordinate hit tests only where the interaction genuinely probes a different point.
