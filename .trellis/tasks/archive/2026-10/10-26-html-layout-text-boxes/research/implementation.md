# Implementation research

The current Vue modal already supports selecting and dragging text, editing source-verified plain text, image insertion/removal, inline style patches and a final single-document commit. Extend those paths rather than adding a second editor or a rich-text dependency.

`appendHtmlLayoutImage` preserves the frame's closing indentation and avoids blank lines that split CommonMark HTML. Share that insertion/removal mechanism for text. A span is valid both inside a div and inside the currently supported paragraph frames. Add a persistent text-box attribute so an intentionally empty new box remains selectable.

The sidebar can use existing form styling: Add Text / Delete Text actions, a font-size number input and a native color picker. Source helpers validate these new properties and restrict them to text targets. Keep styling in `HtmlLayoutEdit` so the existing restore and draft flush mechanisms include it automatically.

Trellis is already installed locally at 0.5.12. Initialization used the Codex and monorepo options without overwriting AGENTS.md. Project files and a scoped task are sufficient; no application runtime dependency or global Codex configuration change is needed. Reference: https://github.com/mindfold-ai/Trellis and https://docs.trytrellis.app/ .
