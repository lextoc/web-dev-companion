# Repository Instructions

## Project Context

Web Dev Companion is an Electron, Vue 3, and TypeScript desktop app for managing local web development repositories.

Use `pnpm` for all package commands.

## Environment

- Use Node.js `20.19.4`.
- Use pnpm `10.14.0`.
- If needed, run `nvm use` from the repository root.

## Common Commands

- Install dependencies: `pnpm install`
- Start development app: `pnpm run dev`
- Run tests: `pnpm test`
- Build app: `pnpm run build`

## Testing Policy

- Run `pnpm test` after code changes unless the user explicitly says not to.
- Do not add or modify tests unless the user explicitly asks for tests.
- If a change affects behavior but tests were not added because the user did not ask, mention that in the final response.
- If tests cannot be run, explain why and include the command that should be run.

## Change Guidelines

- Keep changes scoped to the user's request.
- Prefer existing Vue, TypeScript, Electron, and styling patterns already used in the repo.
- Do not edit generated build output unless explicitly requested.
- Do not revert unrelated user changes.
- Review `README.md` and `AGENTS.md` after each completed task and mention only worthwhile update suggestions.

## Final Response

- Summarize what changed and what verification was run.
- If code changed, include a suggested Angular-style commit message, for example:
  - `fix: handle missing repository branch metadata`
  - `feat: add repository script presets`
  - `docs: clarify development setup`
