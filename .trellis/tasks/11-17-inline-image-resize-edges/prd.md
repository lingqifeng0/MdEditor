# Keep selected inline images resizable while scrolling

The user selected the thin outline prototype. A tall inline image can be resized at any visible point on either side while it remains selected. Scrolling should move the outline with the image without dismissing it or reserving space in the document.

- Keep only the left and right sides draggable, with a larger hit area than the visible line.
- Reuse the existing width update and image alignment behavior. A left-aligned image keeps its left edge anchored.
- Scope the outline to its selected image container. The scroll view clips it naturally at its boundaries and the editor can still dismiss it when the user clicks elsewhere or switches documents.
- Verify real wheel scrolling beyond the midpoint, edge dragging, immediate changes in width, saved Markdown, undo, and dismissal outside the image.

The HTML layout editor redesign is a separate design discussion.

## Verification

The renderer build and desktop typecheck passed. The focused Muya suite passed 25 tests. The Electron end-to-end test passed with a 1,760 px tall inline image, checking the visible edge after a wheel scroll, clipping outside the editor viewport, fixed left alignment, the written width, outside-click dismissal, and undo. The existing five image viewer tests passed in the same run. The user requested the HTML interaction preview before packaging.
