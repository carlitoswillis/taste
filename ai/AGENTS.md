# Agent Guidelines (AGENTS.md)

PURPOSE: This is the authoritative rulebook for AI assistants. It defines the 'how' and 'what' of the codebase.

## Project Context
- **Objective**: A personal, local-first film taste app. The user's ratings, director progress, watchlist, and taste analysis live as JSON in `data/`; a build script renders them into a static page viewed locally. Future: a logging layer so users add films without hand-editing JSON, Letterboxd import/sync, where-to-watch data.
- **Stack**: Plain Node.js (>=18), zero npm dependencies. ES modules in `scripts/`. Static HTML/CSS output. Free external APIs only: Letterboxd RSS (no key), TMDB (free key), OMDb (planned).

## Architecture Constraints
- **Local-first and personal**: nothing gets published externally without the user explicitly asking. The Pages deploy workflow is manual-trigger only. The GitHub repo is private.
- **Data/presentation separation**: all content lives in `data/*.json` + `config.json`; `scripts/build.mjs` is the only renderer. Never hardcode profile content in templates or scripts.
- **Zero dependencies**: no npm packages. If a task seems to need one, flag it to the pilot first.
- **Generated vs. authored data**: `data/letterboxd.json` and `data/enrichment.json` are script-generated; everything else in `data/` is human-authored. Scripts must not overwrite authored files without an explicit reconcile step.
- **Markdown Persistence**: All project state must be tracked in `/ai` (PROJECT_STATE.md).

## Coding Conventions
- **Explicit over Implicit**: Avoid hidden logic, reflection, or complex inheritance.
- **Verification First**: After any change, `node scripts/build.mjs` must succeed and the output should be eyeballed via `npm start`.
- **Compact Context**: Keep context files task-scoped and minimal.
- Text fields in data files support `**bold**` / `*italic*` micro-markdown; everything else is HTML-escaped by the build.

## How to Navigate This Workspace (Priority Flow)
To minimize token waste and maximize focus, follow this priority sequence:
1. **START HERE**: Read `ai/PROJECT_STATE.md`. It defines what this is, the current focus, active tasks, and backlog.
2. **Operational Rules**: Read `ai/AGENTS.md` (this file). Adhere strictly to these constraints.
3. **System Design**: Read `ai/ARCHITECTURE.md` for data flow and component layout.
4. **Self-Correction**: If your understanding of the project state feels out of sync, run `./ai/ai-context.sh` to refresh the context bundle.
