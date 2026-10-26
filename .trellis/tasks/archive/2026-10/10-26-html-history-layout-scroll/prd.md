# HTML layout history, deletion stability and scrolling

## User report and goal

The v8.32 preview needs Ctrl+Z while the HTML layout modal is open. Deleting a caption in the supplied three-image, bottom-aligned flex row moves its image; images must retain their prior positions. The user also reports severe wheel/mouse lag in image-heavy parts of a real Markdown note after the preview update.

## Confirmed behavior

- Modal undo restores its own operations, including object insertion/deletion, movement/resizing and text/style edits. Redo should use Ctrl+Shift+Z / Ctrl+Y. It must not undo unrelated document edits behind the modal.
- Delete a caption without moving/resizing the surviving images or shrinking the outer frame unexpectedly.
- Measure image-heavy scrolling with the supplied note copied into ignored validation output and compare the previous stable package with v8.32. Diagnose the costly path before choosing a performance change.
- Preserve existing draft Apply/Cancel, source mode, image asset cleanup and the final document undo transaction.
- Continue using Trellis and preserve independent plugin boundaries. Do not edit the user's note, installed program, settings or video plugin.

## Existing evidence

The supplied image group uses `align-items:flex-end` with an image and caption inside each column. Caption removal currently patches source and rebuilds normal flow without freezing the prior rendered geometry. The modal keydown handler only handles Escape/Tab; document undo after Apply does not provide modal history. The v8.32 renderer feature changes are confined to the modal/source helper, so a scrolling regression requires runtime profiling and a baseline comparison.

## Acceptance

- [x] Ctrl+Z / redo work inside the modal for structural, gesture and field edits, with stable selection and no background-document undo.
- [x] Deleting a caption from a bottom-aligned multi-image group preserves image rectangles and outer bounds, including Apply/reopen and undo.
- [x] Scrolling diagnosis includes real-note reproduction evidence and representative image-heavy wheel/frame measurements.
- [x] The evidenced performance issue is corrected without disabling image interactions or weakening editor behavior.
- [x] Relevant existing and focused tests, typecheck and changed-file lint pass.
- [x] A new local preview package passes packaged smoke tests, and the task/spec/journal records are complete.

## Delivery

Create the next local preview after validation. Keep the v8.32 preview available for comparison. Do not push a GitHub release for this repair unless the user asks.
