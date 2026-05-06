import fs from 'node:fs/promises'
import path from 'node:path'
import type { PersistedAppState } from '../src/app-state'
import type { PinnedScript } from '../src/repositories'
import { normalizeAppSettings, type AppSettings } from '../src/settings'

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry): entry is string => typeof entry === 'string')
}

function isPinnedScript(script: unknown): script is PinnedScript {
  return (
    typeof script === 'object' &&
    script !== null &&
    typeof (script as Pick<PinnedScript, 'repoPath'>).repoPath === 'string' &&
    typeof (script as Pick<PinnedScript, 'repoName'>).repoName === 'string' &&
    typeof (script as Pick<PinnedScript, 'scriptName'>).scriptName === 'string' &&
    typeof (script as Pick<PinnedScript, 'command'>).command === 'string' &&
    ((script as Pick<PinnedScript, 'packageManager'>).packageManager === undefined ||
      typeof (script as Pick<PinnedScript, 'packageManager'>).packageManager === 'string')
  )
}

function isPinnedScriptList(value: unknown): value is PinnedScript[] {
  return Array.isArray(value) && value.every(isPinnedScript)
}

function normalizeAppState(state: Partial<PersistedAppState>): PersistedAppState {
  return {
    settings: normalizeAppSettings(state.settings ?? {}),
    pinnedRepositoryPaths: isStringArray(state.pinnedRepositoryPaths) ? state.pinnedRepositoryPaths : [],
    pinnedScripts: isPinnedScriptList(state.pinnedScripts) ? state.pinnedScripts : [],
    recentCommandIds: isStringArray(state.recentCommandIds) ? state.recentCommandIds : [],
  }
}

export function createAppStateService(appStateFilePath: () => string) {
  let writeQueue: Promise<void> = Promise.resolve()

  async function readAppStateFile() {
    try {
      const content = await fs.readFile(appStateFilePath(), 'utf8')
      const parsed = JSON.parse(content) as Partial<PersistedAppState>

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return normalizeAppState({})
      }

      return normalizeAppState(parsed)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return normalizeAppState({})
      }

      throw error
    }
  }

  async function readAppState() {
    await writeQueue
    return readAppStateFile()
  }

  async function writeAppState(state: PersistedAppState) {
    await fs.mkdir(path.dirname(appStateFilePath()), { recursive: true })
    await fs.writeFile(appStateFilePath(), JSON.stringify(normalizeAppState(state), null, 2))
  }

  async function updateAppState(updater: (state: PersistedAppState) => PersistedAppState) {
    const writeOperation = writeQueue.then(async () => {
      const state = await readAppStateFile()
      const normalizedState = normalizeAppState(updater(state))
      await writeAppState(normalizedState)
      return normalizedState
    })

    writeQueue = writeOperation.then(
      () => undefined,
      () => undefined,
    )

    return writeOperation
  }

  async function saveSettings(settings: AppSettings) {
    const nextState = await updateAppState((state) => ({
      ...state,
      settings,
    }))

    return nextState.settings
  }

  async function savePinnedRepositoryPaths(repoPaths: string[]) {
    const nextState = await updateAppState((state) => ({
      ...state,
      pinnedRepositoryPaths: repoPaths,
    }))

    return nextState.pinnedRepositoryPaths
  }

  async function savePinnedScripts(scripts: PinnedScript[]) {
    const nextState = await updateAppState((state) => ({
      ...state,
      pinnedScripts: scripts,
    }))

    return nextState.pinnedScripts
  }

  async function saveRecentCommandIds(commandIds: string[]) {
    const nextState = await updateAppState((state) => ({
      ...state,
      recentCommandIds: commandIds,
    }))

    return nextState.recentCommandIds
  }

  return {
    read: readAppState,
    saveSettings,
    savePinnedRepositoryPaths,
    savePinnedScripts,
    saveRecentCommandIds,
  }
}
