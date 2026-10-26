# Reproduction and implementation findings

## Caption deletion

The supplied note uses a bottom-aligned flex row with three inline-flex `span` columns, each containing an image and a caption. Removing a caption from normal flow shrinks the column and repositions its image. Source-range deletion alone is insufficient for a visual layout editor.

Preserve the measured boxes of the complete frame, nested image/caption columns and leaf objects before structural removal, using the existing source-patch edit path. Nested image-containing spans must be recognized as complete containers, including positioned spans; otherwise an absolute child would use an untracked containing block. The synthetic real-window reproduction includes a relatively positioned, center-justified column and verifies all image rectangles plus frame size through deletion, undo, redo and Apply/reopen.

## Modal history

The modal previously handled Escape/Tab only. The application Edit menu routes undo/redo separately through renderer events, so supporting DOM keydown alone would still let native menu commands reach document history.

Use bounded immutable draft snapshots, with short typing bursts grouped by field. Snapshots include source mode, source text, pending source edits, selection, group freeze/restore baselines, root lock and deferred image-removal choices. Added image sources remain in the session cleanup ledger even after undo; close/apply still performs the existing reference-aware cleanup. The modal consumes both DOM shortcuts and application-menu commands; the final Apply remains one background-document edit transaction.

## Image-heavy scrolling

The user note and 239 asset files were copied into ignored validation output, and the original v8.31 portable archive was extracted into an isolated comparison directory. Both versions use Electron 42.1.0 and disposable dark-theme profiles.

The same 65 wheel/mouse steps showed nearly identical costs in v8.31 and v8.32: roughly 2.0 s of ScriptDuration and a frame-interval p95 of about 40 ms in this machine/run. CPU profiles identify repeated `document.elementsFromPoint` calls from preview, paragraph and table hover tools as the largest JavaScript hot path. This evidence does not attribute the underlying cost to the new text-box feature. Heading geometry queries also occur, but their measured total cost is substantially smaller.

The chosen fix reuses the browser-provided mouse target's ancestor path for the actual pointer coordinate. Offset probes at table edges and paragraph margins still use real coordinate hit tests. Paragraph controls short-circuit their margin probe when the primary path already identifies the block. Foreground overlays are respected rather than finding a block behind them. Focused engine tests cover direct targets, overlays, offset probes and disconnected deferred targets.

Performance reports and CPU profiles are local to `validation/html-regressions-20261026/`, not committed with the user's note or assets. Final build measurements and the packaged smoke checks are recorded in verification.md.
