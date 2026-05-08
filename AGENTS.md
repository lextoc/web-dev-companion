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
- Build alpha release artifacts: `pnpm run release:alpha`

## Testing Policy

- Run `pnpm test` after code changes unless the user explicitly says not to.
- Do not add or modify tests unless the user explicitly asks for tests.
- If a change affects behavior but tests were not added because the user did not ask, mention that in the final response.
- If tests cannot be run, explain why and include the command that should be run.

## Change Guidelines

- Keep changes scoped to the user's request.
- Prefer existing Vue, TypeScript, Electron, and styling patterns already used in the repo.
- Do not store sensitive information that cannot be committed to a public repository, including credentials, tokens, private keys, certificates, app-specific passwords, private environment files, or personal data.
- Do not edit generated build output unless explicitly requested.
- Do not revert unrelated user changes.
- Review `README.md` and `AGENTS.md` after each completed task and mention only worthwhile update suggestions.

## Alpha Release Flow

- Start from a clean `main` branch that is up to date with `origin/main`.
- Bump the prerelease version in `package.json` before building, for example `0.1.0-alpha.1` to `0.1.0-alpha.2`.
- Update the README download links for macOS and Windows to the new tag and generated artifact names, using the final asset names reported by GitHub. Only link macOS artifacts after they are signed and notarized.
- Confirm macOS signing and notarization credentials are available before building macOS release artifacts.
- Run `pnpm test` before release builds.
- Run `pnpm run release:alpha` for macOS and Windows x64 artifacts, or use `pnpm run release:alpha:mac` / `pnpm run release:alpha:win` for a platform-specific alpha.
- Commit the version and documentation changes after verification.
- Create a matching Git tag named `v<version>`, for example `v0.1.0-alpha.2`.
- Push both the branch and tag when publishing: `git push origin main` and `git push origin v<version>`.
- Create or update the GitHub prerelease for that tag and upload the generated macOS and Windows artifacts so the README download links resolve.
- Do not commit generated `release/<version>/`, `dist/`, or `dist-electron/` output.

## Final Response

- Summarize what changed and what verification was run.
- If code changed, include a suggested Angular-style commit message, for example:
  - `fix: handle missing repository branch metadata`
  - `feat: add repository script presets`
  - `docs: clarify development setup`
