# MdEditor development workflow

This project was initialized with Trellis 0.5.12 for Codex and this monorepo. Trellis records engineering specifications, task requirements and session history; it is not an application or video-plugin runtime dependency.

Read `../AGENTS.md`, `workflow.md`, the package-specific spec index, and the current task's PRD before implementing a feature. The initial concrete specs cover application/plugin ownership and the desktop HTML layout editor. Other generated package guides are starter templates to populate when working on those packages; the bootstrap task tracks that remaining work.

Codex uses `dispatch_mode: inline`. Shared skills are under `.agents/skills/trellis-*`. Task and session scripts run with Python 3; on Windows use `py -3`. The project does not change the user's global Codex hook settings; follow the AGENTS entry point/manual start skill when hooks are unavailable.

```powershell
py -3 .trellis/scripts/get_context.py
py -3 .trellis/scripts/task.py list
py -3 .trellis/scripts/task.py create "Feature title" --slug feature-name
py -3 .trellis/scripts/task.py start <task-directory>
```

Confirmed constraints include independent plugin packaging, user confirmation before plugin design changes, disposable validation profiles, source-preserving HTML edits and preservation of upstream licenses. Journal auto-commit is disabled so changes can be reviewed and committed explicitly.

The Trellis development scaffold is generated from https://github.com/mindfold-ai/Trellis . Its license is retained in `LICENSE.Trellis`; application and upstream notices are in the repository's root LICENSE and NOTICE.md. Trellis files are outside the desktop runtime package.
