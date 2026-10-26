# MdEditor module boundaries

- The application owns generic Markdown editing, HTML layout editing, document history, file services and the public SDK 2 plugin host.
- `independent-plugins/video-study` owns timestamp parsing, player settings, player launch arguments, process identity checks and mpv IPC. A plugin update ships as its own `.mtplug` and does not require modifying the application.
- Plugin design, capability restrictions and responsibility changes require a concrete explanation and user confirmation before implementation. Preserve the user's chosen executable rather than imposing product-name restrictions.
- Use the existing renderer/preload/main boundaries and preserve context isolation. No renderer Node access.
- Use disposable profiles, synthetic notes and copied players for tests. Do not modify a user's installed application, plugins, notes or configuration during verification.
- Preserve compatibility identifiers and the MIT/upstream notices. Trellis manages development context and is not a product runtime dependency.
- Keep source, specs and tasks in Git. Keep dependencies, generated binaries, validation profiles, credentials and personal notes outside tracked files.
