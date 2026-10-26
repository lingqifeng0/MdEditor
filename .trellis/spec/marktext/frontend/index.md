# Frontend Development Guidelines

## Pre-Development Checklist

1. Read the repository `AGENTS.md` and `.github/COMMENTING-GUIDELINES.md`.
2. Read [module boundaries](../../guides/project-boundaries.md) for every change.
3. For HTML layout work, read [the HTML layout contract](./html-layout.md) before editing the component or its source helpers.
4. Discover the nearest existing implementation and tests. Desktop renderer code uses Vue 3, TypeScript strict mode, two spaces and single quotes.

## Quality Check

Run the affected unit tests and renderer typecheck. Interactive editor changes also need a real Electron check with disposable profiles and generated notes. Verify Apply, Cancel, save/reopen and undo. Keep generated builds, user data and local validation output out of Git.

Before delivering a Windows preview, follow [packaging checks](../../guides/windows-packaging.md), including an actual packaged-executable smoke test.

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | To fill |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | To fill |
| [State Management](./state-management.md) | Local state, global state, server state | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Type Safety](./type-safety.md) | Type patterns, validation | To fill |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
