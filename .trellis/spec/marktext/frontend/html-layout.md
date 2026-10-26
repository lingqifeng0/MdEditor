# HTML layout editing contract

## Ownership and data flow

`components/htmlLayoutEditor/index.vue` owns a modal draft. `util/htmlLayout.ts` maps visual targets back to source ranges and applies bounded patches. `htmlLayoutResponsive.ts` preserves responsive image geometry. The editor commit callback applies one document transaction only after Apply; Cancel discards the draft.

## Source preservation

- Patch the author's source ranges. Do not serialize the whole parsed DOM to save an unrelated text or style edit.
- Preserve image paths, existing markup, attributes, comments, source order and neighboring source bytes.
- New inline text boxes must use an HTML element legal inside the current frame, including a paragraph frame. Escape text and attributes. Encode text newlines so blank lines cannot split a CommonMark HTML block.
- Preview source-position markers never enter saved HTML. A persistent text-box marker may identify an intentionally empty, user-created box.
- Apply text content changes only to source-verified plain text targets. Rich markup must not be flattened.

## Interaction

- Whole-box font size and color are the confirmed scope for this task. Preserve existing styling unless that property is edited.
- Selection, dragging, resizing, source mode, Apply/Cancel, restore and undo must remain consistent for images and text.
- Adding text must select the new object and focus the existing text-content field. Deleting text removes only that object, never its frame or image siblings.
- New text must not move or distort existing images. Existing image overlap validation and file cleanup remain image-specific.

## Verification

Use Vitest for source preservation, escaping, empty/multiline text, style validation and deletion. Use an isolated Electron test for add/edit/size/color/delete, source-mode round trips, save/reopen, Cancel and undo. Also run the existing HTML layout tests.

## Signatures

- `appendHtmlLayoutText(model, { text, style? }): string` appends an escaped inline span inside a complete frame.
- `removeHtmlLayoutText(model, id): string` removes only a text target; passing an image, missing id or the root frame returns the original source.
- `HtmlLayoutEdit.fontSize?: number` and `color?: string` apply to text targets only, through the existing draft and source patch mechanism.

## Validation and cases

| Input | Required result |
| --- | --- |
| Empty text | Persist `data-mt-textbox="true"` and `min-height: 1.5em`; the new empty object remains selectable. |
| Text with blank lines or `<` / `&` | Encode entities, including `&#10;`, without introducing blank source lines. |
| Non-finite or non-positive stored font size | Reject the edit. The UI commits sizes from 8 through 200 px. |
| Color edit | Accept a six-digit hexadecimal color; reject CSS declaration injection. |
| Text styles on an image | Reject without modifying source. |
| Rich markup | Preserve child markup; whole-object style editing is allowed, plain content replacement remains guarded. |

Good: a new span inside a paragraph image frame remains within one CommonMark block. Bad: inserting a nested paragraph or literal blank source lines can close/split the frame.

## Runtime and test details

- Number inputs preview valid positive values on `input` and normalize their bounds on `change`; do not rely solely on Tab/blur to commit font changes.
- Paste originating in an input or textarea retains native text editing. Canvas paste remains image-specific.
- Electron tests must await the modal disappearing after Apply before switching source mode, saving or closing. Apply performs asynchronous image/layout validation; switching early legitimately cancels the draft.
- Hidden Electron windows may stop compositor screenshots and background frames. Disable background throttling for the isolated window; show it without focus when capturing its real pixels. Trigger save/undo through their public menu/IPC path when native window focus is absent.
- JSDOM currently keeps the first duplicate `!important` color. Check preserved source declarations in unit tests and the actual computed saved color in Chromium; do not rewrite unrelated author CSS to accommodate this parser limitation.

## Regression coverage

`html-layout-text-actions.spec.ts` covers escaped insertion, newline preservation, empty objects, existing styles, malformed style inputs and exact deletion. `html-layout-text-boxes.spec.ts` covers real selection/focus, font/color preview, dragging, source-mode round trip, existing important colors, Cancel, undo and save/reopen with a fresh profile.
