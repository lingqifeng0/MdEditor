# HTML layout editor redesign

Give images, text boxes, and tables a common canvas. The user finds the current right sidebar crowded and wants to try the interaction before packaging.

## Prototype for review

- Keep universal insertion actions above the canvas. Place the current object's controls in a compact inspector. Make the object list optional for crowded or overlapping layouts.
- Start the editor preview with an empty selection. Show the whole-table handle only when that table or one of its cells is selected. Select a cell to edit its text and styles, then use the handle or object list to select the whole table for movement and sizing.
- Make the table color destination explicit before applying the color. Preview a cell, a row, the header, and the whole table as scopes for both fill and text color.
- Keep source-mode access, apply/cancel, and draft history.

## Layering, sizing, and formatting

- Show the frontmost object first in the object list. New objects start at the front. Use the list to select obscured objects, and use the object menu to move an object up or down one layer or delete it. Selection leaves the layer order intact. Verify intentional overlap can round-trip through the saved HTML before changing the existing image-overlap check.
- Give entire objects pixel width and height fields. Use a corner handle for images and independent text boxes. Lock image proportions by default. Select the whole table to resize it using its full right and bottom edges. Resize its row and column tracks proportionally within the available space and text minimums.
- Use fine solid gridlines and a thin dashed outline for the selected cell or whole table. On painted cells, use a light or dark selection outline according to the fill. Drag the full right edge for column width and the full bottom edge for row height. Show the column width and row height in the inspector as live readouts. Changing one track changes the table's total size while keeping other tracks at their existing sizes. Record one undo step per drag. Keep row and column deletion explicit and reversible.
- Put cell fill and whole-table line color under Table Style. The fill follows the selected cell, row, header, or table scope. The line color applies to the inner grid and perimeter, including newly inserted rows. Put font family, size, and text color under Font. Share the editable common-color slots. Save the palette as a user preference when implementing the app and store applied color values in the document.
- Put the shared color controls above conditional properties. Keep the mode controls, swatches, custom picker, clear button, and palette disclosure at fixed positions when switching fill, line color, or Font. Put scope, font fields, and dimensions below. Show a read-only whole-table scope for line colors while preserving the last editable scope.

## Text editing in the revised prototype

- Edit directly in a cell. Use the cell selection border as the focus cue. Keep the active cell and caret when a text selection drags past the cell edge.
- Wrap text within the column and grow the row to fit. Manual row height sets a minimum. Keep columns wide enough for a character at the chosen font size.
- Use the same wrapping rules for independent text boxes. Width sets the available line length and the box grows with its text. Manual height provides a minimum for deliberate spacing. Extend the preview frame to contain the resulting boxes and keep sibling positions.
- Preserve leading and internal blank lines through draft undo, redo, and Apply/Cancel. Encode explicit line breaks in the HTML example so they can survive in Markdown blocks.

Verified in Edge using pointer and keyboard input. Checks covered focus in a tall cell, selection beyond the cell edge, long text and identifiers, resizing with 36 px Chinese text, text box resizing, undo and redo, source preview, and Apply/Cancel. The thin cell edges also passed off-center drags, text selection across the edge, and width resizing after wheel scrolling past the middle of a tall cell.

Route draft undo and redo throughout the editor preview, including after clicking blank canvas space. Preserve the frame or empty selection when that is where undo or redo starts. Keep native typing undo in property text and number fields. Verified the reported green-table sequence in Edge before and after the fix. Fill, grid, and text colors can be edited independently and are preserved in the HTML preview. Verified grid color on new rows and undo while viewing source.

## Outer frame sizing

- Draw the resting HTML frame with a thin solid border and switch to a dashed border on selection. Selecting the HTML frame exposes width and height fields. Drag the full right edge for width and the full bottom edge for height, with a larger hit area than the visible thin outline. A drag can begin directly on the border. Keep content positions and dimensions when resizing the frame. The frame can shrink to its content bounds and the canvas scrolls horizontally when the frame is wider than the available view.
- Record each frame size change as one draft history step. Keep explicit frame dimensions in the prototype HTML source and the Apply/Cancel state.

Verified in Edge with pixel input, drags away from each edge midpoint, and dragging the visible right edge after wheel scrolling past the midpoint of a 1,760 px frame. Checks also covered content bounds, unchanged inner layout, undo and redo, wide and narrow canvas views, and source and draft round trips.

The dashed selection revision passed checks for each selection level, independent cell fill and text colors and their generated HTML, whole-table edge resizing, and resizing a tall table from its visible edge after scrolling.

Verified in Edge that the color controls keep the same panel coordinates across color modes, cell and whole-table selections, and text boxes. Checked the narrow layout, retained scope, and crop-free palette expansion.

## Approved implementation

The user approved coding the demonstrated workflow on November 18. Keep the changes in the desktop renderer and its tests.

- Track tables and their cells in the source model. Patch row, column, and style source ranges while retaining authored attributes, comments, rich cell content, and surrounding Markdown. Keep merged and irregular tables editable for color and whole-table size while preserving their row and column structure.
- Convert a complete paragraph wrapper to a legal block wrapper when inserting a table. Wrap a standalone table when the user adds another object. Preserve the measured existing layout during insertion and external frame resizing.
- Use a native in-place textarea in the sanitized modal preview for source-verified plain text. Store only escaped text and authored CSS in the Markdown. Store the shared color slots in the renderer profile. Keep accidental image overlap validation and allow explicitly ordered overlapping layers to round-trip.
- Route draft commands from the modal canvas and preserve an empty selection through history actions. Apply remains a single document transaction.

## Desktop verification

- The desktop renderer built successfully. TypeScript, scoped ESLint, and `git diff --check` passed.
- All 371 HTML layout unit tests and all 14 Windows Electron HTML layout tests passed.
- Electron checks exercised off-center right and bottom edge drags, adjacent track sizes, fixed palette coordinates, independent fill and grid styles, custom swatches, layer ordering, and blank-canvas undo and redo. They also checked preserved image positions, old captions, Cancel, and saving and reopening Markdown in a fresh profile.

## v8.39 Windows delivery

- The NSIS installer payload and the portable ZIP each launched a note and returned matches through packaged ripgrep in isolated profiles. The portable archive passed CRC and byte checks and contains an empty portable profile.
- All 17 targeted Electron checks passed against `MdEditor.exe` extracted from the portable ZIP. The suite included the HTML editor, tall inline image resizing, and file and text search.
