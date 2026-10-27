# Windows preview packaging

## Build inputs

Use the repository-pinned pnpm 10.33.4 for installation and invoke electron-builder through `pnpm exec` or the existing pnpm build scripts. Running the builder directly without package-manager environment metadata can make it select the npm collector for this pnpm workspace. In the 2026-10-26 preview check, that omitted the installed `@vscode/ripgrep-win32-x64` optional package and blocked startup before a window was created.

The desktop `electron-builder.yml` positively includes compiled `out/**` and package metadata. Runtime dependencies are collected separately; static resources and license notices are copied through `extraResources`. Do not rely on the default broad file glob: it also admits test fixtures, screenshots, test results and development configuration into `app.asar`.

## Delivery checks

1. Check the packaged manifest version, compiled renderer and required platform binaries, including `@vscode/ripgrep-win32-x64/bin/rg.exe` for Windows x64.
2. Inspect archive paths to ensure source tests, test results, Trellis, dependencies used only for development, and personal data are excluded. Trellis remains repository development tooling.
3. Run representative Electron UI tests against the actual packaged executable using `MARKTEXT_TEST_EXECUTABLE`, not only the development Electron executable. Use disposable profiles and notes. Startup and save/reopen must pass.
4. Build the portable archive with `scripts/package-portable.py`. Its root folder is `MdEditor/`; the executable is `MdEditor.exe`, while the legacy data directory remains `marktext-user-data` for settings compatibility.
5. Verify archive CRC, file bytes and SHA-256. The portable packager must not copy real user data or follow dependency junctions.

Uninstalled optional binaries for other operating systems may be reported by the collector. Verify that the current platform's required binary exists in the final package rather than treating every optional warning as equivalent.

## Debugging a startup-only failure

An Electron automation timeout before `firstWindow()` does not prove the new renderer feature failed. Inspect the packaged dependencies and a disposable startup profile. If module evaluation fails before the application's exception logger is registered, use the Node inspector to identify the missing module; a renderer screenshot or extra UI timeout will not reveal it. Correct packaging inputs instead of weakening runtime module validation.
