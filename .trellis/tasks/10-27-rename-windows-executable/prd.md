# Windows executable naming

## User-visible problem

The v8.32 portable package is branded MdEditor, but the Windows executable inside the archive is still named `MarkTextToolbar.exe`. This makes the package look like the old project and conflicts with the requested MdEditor product name.

## Scope

- Set the Windows electron-builder executable name to `MdEditor.exe`.
- Update the portable packager, tests, README and packaging guidance to use the new executable name.
- Update the local v8.32 usage note after rebuilding the package.
- Keep the existing Markdown ProgId and legacy app-data directory for this migration so installed file associations and existing user settings remain usable.
- Do not change the independent video plugin or embed plugin logic into the host.

## Acceptance criteria

1. A Windows x64 build contains `MdEditor.exe` and does not contain `MarkTextToolbar.exe` as the application executable.
2. The portable ZIP root remains `MdEditor/` and the packager verifies `MdEditor.exe`.
3. Unit tests and typecheck/build checks pass.
4. Representative packaged startup/UI validation passes with the renamed executable.
5. The final local v8.32 package and its checksum are refreshed without changing the version number.
