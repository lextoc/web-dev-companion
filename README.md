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
