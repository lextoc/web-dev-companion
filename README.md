# Web Dev Companion

Desktop companion for managing local web development repositories.

Web Dev Companion is an Electron, Vue 3, and TypeScript app for keeping local projects in view. It tracks saved repositories, shows Git status and branch details, opens projects in your editor or terminal, and runs repository scripts from a focused desktop UI.

## Features

- Save and browse local Git repositories.
- Search, sort, and pin frequently used repositories.
- Review branch, remote, dirty state, file status details, diffs, and recent commits.
- Stage and unstage files, write commits, and inspect commit details from the repository view.
- Sync, switch, create tracking branches from remotes, and remove safe local branches.
- Manage submodule branch links, merge linked parent/submodule branches downward, and remove safe local-only submodule branches.
- Review project health, including package manager detection, Node configuration, lockfile and install state, outdated dependencies, and common script checks.
- Run available health scripts from the health panel or before committing.
- Open repositories in the file manager, configured editor, or terminal.
- Run, pin, monitor, restart, and stop package scripts in managed terminals.
- Receive desktop notifications when managed scripts fail or finish after a longer run.
- Auto-refresh repository state, including refresh-on-focus for the active repository.
- Use the command palette, recent commands, keyboard shortcuts, and desktop menu shortcuts for common actions.
- Configure theme, editor command, refresh interval, sync confirmation behavior, and commit celebration effects.

## Branch And Submodule Workflow

The branch management modal keeps repository branch work and submodule branch work together:

- Switch local branches, create local tracking branches from remotes, sync branches, and remove safe local branches.
- Select a submodule and manage saved branch links in a small branch-link modal.
- Link repository branches to their matching submodule branches, for example `release/31 -> mono-31` and `release/32 -> mono-32`.
- When you change the repository merge target, the matching saved submodule target is applied automatically when that branch exists locally.
- Use **Merge down** to switch to the target repository branch and target submodule branch, merge the current repository branch into the target repository branch, merge the current submodule branch into the target submodule branch, and stage the submodule pointer update.
- Clean up unused local-only submodule branches from the same branch management flow. Remote branches are not deleted by this action.

Branch links are persisted in the app state, so the app can remember repository/submodule branch pairs across launches.

## Feature Ideas

The current app already covers the daily repository cockpit: saved projects, Git state, commits, branches, scripts, terminals, pins, and fast navigation. Good next features would deepen that workflow without turning the app into a full IDE.

### High-Impact Additions

- **Workspace groups**: group repositories by client, product, stack, or workflow so the dashboard can switch between focused sets instead of one flat list.
- **Script presets**: save multi-script launch profiles such as `dev + api + storybook` and start or stop them together from the dashboard or command palette.
- **Pull request context**: show the current branch's PR link, review state, checks, and mergeability when the repository has a GitHub remote.
- **Commit assistant**: draft a conventional commit message from staged diffs, with editable suggestions before committing.
- **Cross-repository branch cleanup view**: list stale, merged, gone, or local-only branches across repositories and offer safe cleanup actions.
- **Repository notes**: keep small local notes per repository for setup steps, ports, credentials location, or recurring commands.
- **Port and server monitor**: detect running dev servers, show their local URLs, and open or stop the owning process.

### Nice Quality-of-Life Features

- **Dashboard filters**: add saved filters for dirty repositories, running scripts, branch divergence, package manager, and repo group.
- **Command palette workflows**: support compound commands like opening a repo, starting pinned scripts, and opening the terminal in one action.
- **Recent activity timeline**: show recent commits, script runs, branch checkouts, failed commands, and app actions across repositories.
- **Dependency upgrade lane**: detect package updates and run the relevant check or test script after selected upgrades.
- **Environment file awareness**: flag missing `.env` files from `.env.example` and expose quick open/copy actions.
- **Terminal search and markers**: search script output, jump to errors, and preserve important log markers after a run finishes.
- **Repository import scan**: choose a parent folder and discover Git repositories recursively with a review step before saving.
- **Ready-pattern notifications**: let scripts define output patterns that signal when a dev server is ready, then notify or open its local URL.

### Larger Bets

- **Task board for local work**: lightweight per-repository task tracking tied to branches, scripts, notes, and recent commits.
- **Multi-repository operations**: refresh, fetch, install, test, or run scripts across selected repositories with progress and failure summaries.
- **Issue tracker integration**: connect branches and commits to Linear, GitHub Issues, or Jira so local work has product context.
- **AI troubleshooting helper**: summarize failing terminal output and suggest the next command or file to inspect.

## Requirements

- Node.js 20.19.4. Run `nvm use` from the project root if you use nvm.
- pnpm 10.14.0.
- Git available on your `PATH`.

## Setup

```sh
pnpm install
```

This project allows pnpm to run the install scripts required by Electron and
Vite's esbuild dependency. If Electron was installed before that setting was
present and `pnpm run dev` reports that Electron failed to install correctly,
run:

```sh
pnpm rebuild electron
```

## Development

```sh
pnpm run dev
```

The app stores saved repositories, pinned scripts, settings, recent commands, and repository/submodule branch links in Electron's per-user app data directory.

## Verification

```sh
pnpm test
```

The test command runs the Vue TypeScript checker and the Vitest component test suite.

## Build

```sh
pnpm run build
```

Local builds are packaged without macOS code signing, so a development machine's
personal or expired Apple certificates do not affect `pnpm run build`.

Release helpers are also available:

```sh
pnpm run release:alpha
pnpm run release:alpha:mac
pnpm run release:alpha:win
```

Generated build output is intentionally ignored by Git. Commit source files, configuration, lockfiles, and assets instead.

## Publishing To GitHub

Before pushing a new remote:

1. Review `git status` and make sure only intended source changes are staged.
2. Run `pnpm test`.
3. Add a remote with `git remote add origin <repo-url>`.
4. Push the current branch with `git push -u origin <branch-name>`.

## License

Copyright (c) 2026 Alexander Claes. All rights reserved.

This project is proprietary. You may not copy, modify, publish, distribute,
sublicense, sell, or otherwise use this project without prior written permission
from the copyright holder.

Third-party components included with or used by this project remain governed by
their own license terms. See [LICENSE](LICENSE) for details.
