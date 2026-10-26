# Independent video replay plugin

Read `AGENTS.md`, `../../guides/project-boundaries.md` and `independent-plugins/video-study/README.md` before changing this package. It uses SDK 2; no private host player APIs and no player-specific business logic in the application.

Design changes require user confirmation. Keep user-selected executable paths, settings migration, identity verification, cancellation, relative media paths and exact seek confirmation. Build and test the plugin separately and publish a separately versioned `.mtplug`. Test with fixtures and isolated player copies.
