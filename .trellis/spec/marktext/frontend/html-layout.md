# HTML layout editing contract

## Ownership and data flow

`components/htmlLayoutEditor/index.vue` owns a modal draft. `util/htmlLayout.ts` maps visual targets back to source ranges and applies bounded patches. `htmlLayoutResponsive.ts` preserves responsive image geometry. The editor commit callback applies one document transaction only after Apply; Cancel discards the draft.

## Source preservation

- Patch the author's source ranges. Do not serialize the whole parsed DOM to save an unrelated text or style edit.
- Preserve image paths, existing markup, attributes, comments, source order and neighboring source bytes.
- New inline text boxes must use an HTML element legal inside the current frame, including a paragraph frame. Escape text and attributes. Encode text newlines so blank lines cannot split a CommonMark HTML block.
- Preview source-position markers never enter saved HTML. A persistent text-box marker may identify an intentionally empty, user-created box.
- Apply text content changes only to source-verified plain text targets. Rich markup must not be flattened.
- Table cells are source targets and remain part of their table. Patch the affected cell, row, or column ranges. Keep authored attributes and rich content. Merged or incomplete table structures keep their shape and can still receive formatting. Promote a paragraph frame to a block frame when inserting a table.

## Interaction

- Select a plain text box or cell to edit its content in place. New text boxes enter editing immediately. An independent text box or cell grows to fit wrapped text, and an explicit height sets a minimum. Keep other objects anchored when growing the surrounding frame.
- Keep the shared swatches, picker, and clear action in the same position across fill, grid, and font modes. Table fill and font formatting apply to the selected scope. Grid color applies to the whole table. Store the six reusable colors as hex values under `mdeditor.htmlLayout.colors` in renderer local storage. Store applied colors in the document.
- The unselected HTML frame has a thin solid outline. The selected frame, table, or cell has a dashed outline. The full right and bottom edges resize the frame, table, or current column and row. A cell-edge drag leaves the other tracks at their existing sizes. Frame resizing preserves existing child geometry.
- Keep source mode, Apply/Cancel, restore, and undo consistent across objects. Keep the image overlap check for unintended overlaps and honor an explicit sibling layer order. A layer change edits stacking order without moving the objects.
- New text boxes are absolute-positioned children of the complete HTML frame. The frame must be a positioned containing block. Keep text drag and resize inside its content bounds.
- The modal owns an independent bounded draft history. Route both DOM Ctrl/Cmd+Z shortcuts and application-menu undo/redo to it while open; an empty modal history must never fall through to background-document undo. Keep the final Apply as one document transaction.
- Gesture history is recorded once on release. Group short typing bursts by field, keep separate style and structural actions, and invalidate redo when a new edit branches from undo. Undo and redo from blank canvas space preserve its empty or frame selection.
- Structural deletion freezes the measured frame, complete caption columns and surviving leaf boxes before removing source. Normal flex/grid reflow must not change surviving objects. Nested image-containing spans can be complete column containers.

## Verification

Use Vitest for source preservation, escaping, empty/multiline text, style validation and deletion. Use an isolated Electron test for add/edit/size/color/delete, source-mode round trips, save/reopen, Cancel and undo. Also run the existing HTML layout tests.

## Signatures

- `appendHtmlLayoutText(model, { text, style? }): string` appends an escaped inline span inside a complete frame.
- `removeHtmlLayoutText(model, id): string` removes only a text target; passing an image, missing id or the root frame returns the original source.
- `HtmlLayoutEdit.fontSize`, `fontFamily`, and `color` apply to text targets. `backgroundColor` applies to cells. `gridColor`, `columnWidths`, and `rowHeights` apply to tables. Track edits require a complete rectangular source model.
- `editHtmlLayoutTableStructure(model, tableId, action, cellId?)` returns the updated HTML or the original source when the structure cannot be changed. Supported actions are `add-row`, `remove-row`, `add-column`, and `remove-column`.

## Validation and cases

| Input | Required result |
| --- | --- |
| Empty text | Persist `data-mt-textbox="true"` and `min-height: 1.5em`; the new empty object remains selectable. |
| Text with blank lines or `<` / `&` | Encode entities, including `&#10;`, without introducing blank source lines. |
| Non-finite or non-positive stored font size | Reject the edit. The UI commits sizes from 8 through 200 px. |
| Color edit | Accept a six-digit hexadecimal color; reject CSS declaration injection. |
| Table with merged cells or incomplete row source ranges | Keep row and column structure intact. Whole-table resizing and formatting remain available. |
| Text styles on an image | Reject without modifying source. |
| Rich markup | Preserve child markup; whole-object style editing is allowed, plain content replacement remains guarded. |
| Structural delete before an image has measurable dimensions | Leave source intact and show the loading/size error; never freeze guessed image boxes. |
| Rotated/scaled source objects | Preserve author transforms and offer source editing instead of resetting them to guessed rectangles. |

Good: a new span inside a paragraph image frame remains within one CommonMark block. Bad: inserting a nested paragraph or literal blank source lines can close/split the frame.

## Runtime and test details

- Number inputs preview valid positive values on `input` and normalize their bounds on `change`; do not rely solely on Tab/blur to commit font changes.
- Paste originating in an input or textarea retains native text editing. Canvas paste remains image-specific.
- Electron tests must await the modal disappearing after Apply before switching source mode, saving or closing. Apply performs asynchronous image/layout validation; switching early legitimately cancels the draft.
- Hidden Electron windows may stop compositor screenshots and background frames. Disable background throttling for the isolated window; show it without focus when capturing its real pixels. Trigger save/undo through their public menu/IPC path when native window focus is absent.
- JSDOM currently keeps the first duplicate `!important` color. Check preserved source declarations in unit tests and the actual computed saved color in Chromium; do not rewrite unrelated author CSS to accommodate this parser limitation.

## Regression coverage

`html-layout-text-actions.spec.ts` covers escaped insertion, newline preservation, empty objects, existing styles, malformed style inputs and exact deletion. `html-layout-text-boxes.spec.ts` covers real selection/focus, font/color preview, dragging, source-mode round trip, existing important colors, Cancel, undo and save/reopen with a fresh profile.

`html-layout-history.spec.ts` covers draft shortcuts, menu routing, source edits, image geometry transactions and caption deletion in a bottom-aligned flex row through Apply/reopen. Preview sanitization deliberately strips ordinary source data attributes; select test objects through stable fixture IDs or their structure, not an attribute that exists only in saved source.

`html-layout-tables.spec.ts` covers formatting, shared palette position, blank-canvas history, row and column structure, track and frame resizing, rich markup preservation, Cancel, and saving and reopening a real Markdown file.
