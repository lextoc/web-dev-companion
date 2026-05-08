import { computed, ref, type Ref } from 'vue'
import type { RepositoryBranchLink } from '../app-state'
import type { PinnedScript, ProjectTask, RepositoryDetails, RepositorySummary } from '../repositories'
import type { AppFeedbackTone } from './useToasts'

const MAX_RECENT_COMMANDS = 6
export const SCRIPT_REFERENCE_SEPARATOR = '\n'

export function scriptReferenceKey(script: Pick<PinnedScript, 'repoPath' | 'taskId'>) {
  return `${script.repoPath}${SCRIPT_REFERENCE_SEPARATOR}${script.taskId}`
}

function serializablePinnedScript(script: PinnedScript): PinnedScript {
  return {
    repoPath: script.repoPath,
    repoName: script.repoName,
    taskId: script.taskId,
    taskName: script.taskName,
    command: script.command,
    source: script.source,
    cwd: script.cwd,
  }
}

function serializablePinnedScripts(scripts: PinnedScript[]) {
  return scripts.map(serializablePinnedScript)
}

function serializableRepositoryBranchLink(link: RepositoryBranchLink): RepositoryBranchLink {
  return {
    repoPath: link.repoPath,
    parentBranch: link.parentBranch,
    submodulePath: link.submodulePath,
    submoduleBranch: link.submoduleBranch,
    updatedAt: link.updatedAt,
  }
}

function serializableRepositoryBranchLinks(links: RepositoryBranchLink[]) {
  return links.map(serializableRepositoryBranchLink)
}

interface UsePersistedAppStateOptions {
  repositories: Ref<RepositorySummary[]>
  selectedDetails: Ref<RepositoryDetails | null>
  showAppFeedback: (message: string, tone?: AppFeedbackTone) => void
  showError: (error: unknown) => void
}

export function usePersistedAppState({
  repositories,
  selectedDetails,
  showAppFeedback,
  showError,
}: UsePersistedAppStateOptions) {
  const pinnedRepositoryPaths = ref<string[]>([])
  const pinnedScripts = ref<PinnedScript[]>([])
  const recentCommandIds = ref<string[]>([])
  const repositoryBranchLinks = ref<RepositoryBranchLink[]>([])

  const pinnedTaskIdsForSelectedRepo = computed(() => {
    if (!selectedDetails.value) {
      return []
    }

    return pinnedScripts.value
      .filter((script) => script.repoPath === selectedDetails.value?.path)
      .map((script) => script.taskId)
  })

  async function loadPersistedAppState() {
    const persistedState = await window.appState.read()
    pinnedRepositoryPaths.value = persistedState.pinnedRepositoryPaths
    pinnedScripts.value = persistedState.pinnedScripts
    recentCommandIds.value = persistedState.recentCommandIds.slice(0, MAX_RECENT_COMMANDS)
    repositoryBranchLinks.value = persistedState.repositoryBranchLinks
  }

  async function savePinnedRepositories(repoPaths: string[]) {
    const previousRepoPaths = [...pinnedRepositoryPaths.value]
    const savedRepoPaths = [...repoPaths]
    pinnedRepositoryPaths.value = savedRepoPaths

    try {
      pinnedRepositoryPaths.value = await window.appState.savePinnedRepositoryPaths(savedRepoPaths)
      return true
    } catch (error) {
      pinnedRepositoryPaths.value = previousRepoPaths
      showError(error)
      return false
    }
  }

  async function savePinnedScripts(scripts: PinnedScript[]) {
    const previousScripts = serializablePinnedScripts(pinnedScripts.value)
    const savedScripts = serializablePinnedScripts(scripts)
    pinnedScripts.value = savedScripts

    try {
      pinnedScripts.value = await window.appState.savePinnedScripts(savedScripts)
      return true
    } catch (error) {
      pinnedScripts.value = previousScripts
      showError(error)
      return false
    }
  }

  function saveRecentCommands(commandIds: string[]) {
    recentCommandIds.value = commandIds.slice(0, MAX_RECENT_COMMANDS)
    const savedCommandIds = [...recentCommandIds.value]

    void Promise.resolve()
      .then(() => window.appState.saveRecentCommandIds(savedCommandIds))
      .catch(showError)
  }

  async function saveRepositoryBranchLinks(links: RepositoryBranchLink[]) {
    const previousLinks = serializableRepositoryBranchLinks(repositoryBranchLinks.value)
    const savedLinks = serializableRepositoryBranchLinks(links)
    repositoryBranchLinks.value = savedLinks

    try {
      repositoryBranchLinks.value = await window.appState.saveRepositoryBranchLinks(savedLinks)
      return true
    } catch (error) {
      repositoryBranchLinks.value = previousLinks
      showError(error)
      return false
    }
  }

  async function saveRepositoryBranchLink(link: Omit<RepositoryBranchLink, 'updatedAt'>) {
    const savedLink: RepositoryBranchLink = {
      ...link,
      updatedAt: new Date().toISOString(),
    }
    const nextLinks = [
      savedLink,
      ...repositoryBranchLinks.value.filter((existingLink) =>
        existingLink.repoPath !== savedLink.repoPath ||
        existingLink.parentBranch !== savedLink.parentBranch ||
        existingLink.submodulePath !== savedLink.submodulePath
      ),
    ]

    const didSave = await saveRepositoryBranchLinks(nextLinks)

    if (!didSave) {
      return
    }

    showAppFeedback(`Linked ${savedLink.parentBranch} to ${savedLink.submoduleBranch}.`, 'info')
  }

  async function removeRepositoryBranchLink(
    linkToRemove: Pick<RepositoryBranchLink, 'repoPath' | 'parentBranch' | 'submodulePath'>,
  ) {
    const didSave = await saveRepositoryBranchLinks(
      repositoryBranchLinks.value.filter((existingLink) =>
        existingLink.repoPath !== linkToRemove.repoPath ||
        existingLink.parentBranch !== linkToRemove.parentBranch ||
        existingLink.submodulePath !== linkToRemove.submodulePath
      ),
    )

    if (!didSave) {
      return
    }

    showAppFeedback(`Removed link for ${linkToRemove.parentBranch}.`, 'info')
  }

  function rememberCommand(commandId: string) {
    saveRecentCommands([
      commandId,
      ...recentCommandIds.value.filter((recentCommandId) => recentCommandId !== commandId),
    ])
  }

  async function togglePinnedRepository(repoPath: string) {
    const repository = repositories.value.find((savedRepository) => savedRepository.path === repoPath)
    const repositoryName = repository?.name ?? repoPath
    const isPinned = pinnedRepositoryPaths.value.includes(repoPath)

    const didSave = await savePinnedRepositories(
      isPinned
        ? pinnedRepositoryPaths.value.filter((pinnedPath) => pinnedPath !== repoPath)
        : [repoPath, ...pinnedRepositoryPaths.value],
    )
    if (!didSave) {
      return
    }

    showAppFeedback(`${isPinned ? 'Unpinned' : 'Pinned'} ${repositoryName}.`, 'info')
  }

  async function togglePinnedScript(task: ProjectTask) {
    if (!selectedDetails.value) {
      return
    }

    const pinnedScript: PinnedScript = {
      repoPath: selectedDetails.value.path,
      repoName: selectedDetails.value.name,
      taskId: task.id,
      taskName: task.name,
      command: task.command,
      source: task.source,
      cwd: task.cwd,
    }
    const key = scriptReferenceKey(pinnedScript)
    const isPinned = pinnedScripts.value.some((script) => scriptReferenceKey(script) === key)

    const didSave = await savePinnedScripts(
      isPinned
        ? pinnedScripts.value.filter((script) => scriptReferenceKey(script) !== key)
        : [pinnedScript, ...pinnedScripts.value],
    )
    if (!didSave) {
      return
    }

    showAppFeedback(`${isPinned ? 'Unpinned' : 'Pinned'} ${task.name}.`, 'info')
  }

  async function unpinScript(scriptToUnpin: PinnedScript) {
    const didSave = await savePinnedScripts(
      pinnedScripts.value.filter((script) => scriptReferenceKey(script) !== scriptReferenceKey(scriptToUnpin)),
    )
    if (!didSave) {
      return
    }

    showAppFeedback(`Unpinned ${scriptToUnpin.taskName}.`, 'info')
  }

  async function removePinnedScriptsForRepository(repoPath: string) {
    await savePinnedScripts(pinnedScripts.value.filter((script) => script.repoPath !== repoPath))
  }

  return {
    loadPersistedAppState,
    pinnedRepositoryPaths,
    pinnedTaskIdsForSelectedRepo,
    pinnedScripts,
    recentCommandIds,
    rememberCommand,
    removePinnedScriptsForRepository,
    removeRepositoryBranchLink,
    repositoryBranchLinks,
    saveRepositoryBranchLink,
    togglePinnedRepository,
    togglePinnedScript,
    unpinScript,
  }
}
