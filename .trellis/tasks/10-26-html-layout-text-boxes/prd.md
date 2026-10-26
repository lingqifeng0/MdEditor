# HTML layout text boxes

## Goal

Complete the HTML layout editor's text-object lifecycle: add a text box from the right sidebar, edit its content, set its font size and color, and delete the selected text box. Adopt Trellis for project specifications and task history.

## Confirmed scope

- The user requested a right-sidebar button alongside the existing image actions.
- The user confirmed on 2026-10-26: font size and color apply uniformly to the entire selected text box.
- Existing text objects should support style editing and deletion while preserving their markup.
- Reuse the existing HTML draft, source patching, selection and document transaction mechanisms.
- This is an application HTML editor feature. The independent video plugin is unchanged.

## Requirements

1. Add Text creates a visible plain text object within the frame, selects it and focuses the content field.
2. Text content, whole-box font size and a color picker update the preview and save to inline HTML.
3. Delete Text removes only the selected text object. The frame and image siblings remain intact.
4. Empty and multiline new text boxes survive source mode and reopening. Text is escaped rather than interpreted as markup.
5. Existing drag, resize, restore, image actions, Apply, Cancel, undo and save/reopen continue working.
6. Trellis records the task, meaningful project rules and test evidence, preserving existing instructions and licenses.
7. Deliver a local v8.32 portable preview with an `MdEditor/` root and no test artifacts or development workflow files in the runtime package.

## Acceptance criteria

- [x] New text can be added, edited, moved, sized, colored and deleted in the real editor.
- [x] User text containing HTML-like characters and empty lines round-trips safely.
- [x] Existing source and image layout are preserved outside edited ranges.
- [x] Cancel does not alter the document; Apply supports undo; saved results reopen.
- [x] Existing HTML layout tests plus focused tests pass; renderer typecheck and lint checks pass.
- [x] A real UI screenshot and an isolated test record are available for review.

## Out of scope

Partial-selection rich text formatting, font-family tooling, new plugin APIs, video plugin changes, automatic modification of installed software, and remote release publication.

## Research

See [implementation notes](research/implementation.md). No new runtime library is needed.
