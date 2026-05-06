# Web Dev Companion

Desktop companion for managing local web development repositories.

Web Dev Companion is an Electron, Vue 3, and TypeScript app for keeping local projects in view. It tracks saved repositories, shows Git status and branch details, opens projects in your editor or terminal, and runs repository scripts from a focused desktop UI.

## Features

- Save and browse local Git repositories.
- Search, sort, and pin frequently used repositories.
- Review branch, remote, dirty state, and file status details.
- Open repositories in the file manager, configured editor, or terminal.
- Run and monitor package scripts in managed terminals.
- Use the command palette and desktop menu shortcuts for common actions.

## Feature Ideas

The current app already covers the daily repository cockpit: saved projects, Git state, commits, branches, scripts, terminals, pins, and fast navigation. Good next features would deepen that workflow without turning the app into a full IDE.

### High-Impact Additions

- **Workspace groups**: group repositories by client, product, stack, or workflow so the dashboard can switch between focused sets instead of one flat list.
- **Project health checks**: surface package manager, Node version, lockfile state, outdated dependencies, missing install state, and whether common scripts pass.
- **Script presets**: save multi-script launch profiles such as `dev + api + storybook` and start or stop them together from the dashboard or command palette.
- **Pull request context**: show the current branch's PR link, review state, checks, and mergeability when the repository has a GitHub remote.
- **Commit assistant**: draft a conventional commit message from staged diffs, with editable suggestions before committing.
- **Branch cleanup view**: list stale, merged, gone, or local-only branches across repositories and offer safe cleanup actions.
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
- **Notifications for long-running scripts**: notify when scripts fail, complete, or become ready based on output patterns.

### Larger Bets

- **Task board for local work**: lightweight per-repository task tracking tied to branches, scripts, notes, and recent commits.
- **Multi-repository operations**: refresh, fetch, install, test, or run scripts across selected repositories with progress and failure summaries.
- **Issue tracker integration**: connect branches and commits to Linear, GitHub Issues, or Jira so local work has product context.
- **AI troubleshooting helper**: summarize failing terminal output and suggest the next command or file to inspect.

## Requirements

- Node.js 20 or newer.
- pnpm 10.14.0.
- Git available on your `PATH`.

## Setup

```sh
pnpm install
```

## Development

```sh
pnpm run dev
```

The app stores its saved repository list in Electron's per-user app data directory.

## Verification

```sh
pnpm test
```

The test command runs the Vue TypeScript checker. There are currently no unit or end-to-end test suites.

## Build

```sh
pnpm run build
```

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

No public license has been declared yet.
