# MdEditor development

MdEditor is a MarkText-based Electron and Vue Markdown editor. The desktop workspace package remains named `marktext`; the active editor engine is `packages/muya` (`@muyajs/core`). The legacy `muyajs` engine and upstream website are not part of this repository.

## Layout and commands

- `packages/desktop`: main process, preload, Vue renderer, assets and desktop tests.
- `packages/muya`: editor engine. Read its `AGENTS.md` before changing engine code.
- `plugins`: SDK 2 examples. `independent-plugins/video-study`: separate video replay plugin.
- `docs/plugins`: public SDK contracts, declarations and package schema.
- Node.js 22 and pnpm 10.33.4. Run `pnpm install`, `pnpm typecheck`, `pnpm test:unit` and relevant targeted tests.
- `pnpm build:win:x64` builds Windows packages; `python scripts/package-portable.py` creates the portable archive with a `MdEditor/` root.

## Constraints

- TypeScript strict mode; desktop uses two spaces, single quotes and no semicolons. Keep Muya's existing local style.
- Read `.github/COMMENTING-GUIDELINES.md` for comments. Explain invariants and rationale rather than restating code.
- Renderer Node access goes through the typed preload bridge; preserve sandbox and context isolation.
- Keep SDK permissions, document revision checks and edit transactions. Player parsing, native IPC and helper processes belong to the independent video plugin.
- Keep compatibility identifiers (`local.marktext.toolbar`, `MarkTextToolbar.exe`, `marktext-user-data`) unless a deliberate migration is requested.
- Test with disposable profiles and fixtures. Do not change users' installed software, plugins, notes or configuration during verification.
- Commit source, necessary assets, tests and documentation. Do not commit dependencies, generated bundles, installers, personal data, credentials or local validation output.
- Preserve the MIT license and upstream copyright notices.
- Before changing plugin design, responsibilities or module boundaries, explain the proposal and obtain the user's confirmation. An approved implementation can proceed within that scope.

## Trellis

Project development is managed by Trellis. Start with `.trellis/workflow.md` and the relevant index under `.trellis/spec/`. Keep requirements, confirmed decisions and verification results in the task directory. Codex uses the inline workflow; Trellis is development tooling and must not become an application runtime dependency.
