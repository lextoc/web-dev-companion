import fs from 'node:fs/promises'
import path from 'node:path'
import type { PersistedAppState, RepositoryBranchLink } from '../src/app-state'
import type { PinnedScript, ProjectTaskSource } from '../src/repositories'
import { normalizeAppSettings, type AppSettings } from '../src/settings'

const taskSources: ProjectTaskSource[] = ['node', 'gradle', 'maven', 'rails', 'rake']

function normalizeTaskSource(value: unknown): ProjectTaskSource {
  return taskSources.includes(value as ProjectTaskSource) ? value as ProjectTaskSource : 'node'
}

function normalizePinnedScript(script: unknown): PinnedScript | null {
  if (typeof script !== 'object' || script === null) {
    return null
  }

  const value = script as Partial<PinnedScript> & {
    packageManager?: unknown
    scriptName?: unknown
  }
  const legacyScriptName = typeof value.scriptName === 'string' ? value.scriptName : undefined
  const taskName = typeof value.taskName === 'string' ? value.taskName : legacyScriptName
  const taskId = typeof value.taskId === 'string' ? value.taskId : legacyScriptName ? `node:${legacyScriptName}` : undefined
  const source = normalizeTaskSource(value.source)

  if (
    typeof value.repoPath !== 'string' ||
    typeof value.repoName !== 'string' ||
    typeof taskId !== 'string' ||
    typeof taskName !== 'string' ||
    typeof value.command !== 'string'
  ) {
    return null
  }

  return {
    repoPath: value.repoPath,
    repoName: value.repoName,
    taskId,
    taskName,
    command: value.command,
    source,
    cwd: typeof value.cwd === 'string' ? value.cwd : undefined,
  }
}

function normalizePinnedScripts(value: unknown): PinnedScript[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((script) => {
    const pinnedScript = normalizePinnedScript(script)
    return pinnedScript ? [pinnedScript] : []
  })
}

function isRepositoryBranchLink(link: unknown): link is RepositoryBranchLink {
  return (
    typeof link === 'object' &&
    link !== null &&
    typeof (link as Pick<RepositoryBranchLink, 'repoPath'>).repoPath === 'string' &&
    typeof (link as Pick<RepositoryBranchLink, 'parentBranch'>).parentBranch === 'string' &&
    typeof (link as Pick<RepositoryBranchLink, 'submodulePath'>).submodulePath === 'string' &&
    typeof (link as Pick<RepositoryBranchLink, 'submoduleBranch'>).submoduleBranch === 'string' &&
    typeof (link as Pick<RepositoryBranchLink, 'updatedAt'>).updatedAt === 'string'
  )
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

function normalizeRepositoryBranchLinks(value: unknown): RepositoryBranchLink[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isRepositoryBranchLink)
}

function normalizeAppState(state: Partial<PersistedAppState>): PersistedAppState {
  return {
    settings: normalizeAppSettings(state.settings ?? {}),
    pinnedRepositoryPaths: normalizeStringList(state.pinnedRepositoryPaths),
    pinnedScripts: normalizePinnedScripts(state.pinnedScripts),
    recentCommandIds: normalizeStringList(state.recentCommandIds),
    repositoryBranchLinks: normalizeRepositoryBranchLinks(state.repositoryBranchLinks),
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
    const filePath = appStateFilePath()
    const temporaryFilePath = `${filePath}.${process.pid}.tmp`

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(temporaryFilePath, JSON.stringify(normalizeAppState(state), null, 2))
    await fs.rename(temporaryFilePath, filePath)
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

  async function saveRepositoryBranchLinks(links: RepositoryBranchLink[]) {
    const nextState = await updateAppState((state) => ({
      ...state,
      repositoryBranchLinks: links,
    }))

    return nextState.repositoryBranchLinks
  }

  async function flush() {
    await writeQueue
  }

  return {
    flush,
    read: readAppState,
    saveSettings,
    savePinnedRepositoryPaths,
    savePinnedScripts,
    saveRecentCommandIds,
    saveRepositoryBranchLinks,
  }
}
