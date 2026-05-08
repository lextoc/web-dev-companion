import { computed, ref, type Ref } from 'vue'
import type { RepositoryBranchLink } from '../app-state'
import type { PinnedScript, RepositoryDetails, RepositorySummary } from '../repositories'
import type { AppFeedbackTone } from './useToasts'

const MAX_RECENT_COMMANDS = 6
export const SCRIPT_REFERENCE_SEPARATOR = '\n'

export function scriptReferenceKey(script: Pick<PinnedScript, 'repoPath' | 'scriptName'>) {
  return `${script.repoPath}${SCRIPT_REFERENCE_SEPARATOR}${script.scriptName}`
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

  const pinnedScriptNamesForSelectedRepo = computed(() => {
    if (!selectedDetails.value) {
      return []
    }

    return pinnedScripts.value
      .filter((script) => script.repoPath === selectedDetails.value?.path)
      .map((script) => script.scriptName)
  })

  async function loadPersistedAppState() {
    const persistedState = await window.appState.read()
    pinnedRepositoryPaths.value = persistedState.pinnedRepositoryPaths
    pinnedScripts.value = persistedState.pinnedScripts
    recentCommandIds.value = persistedState.recentCommandIds.slice(0, MAX_RECENT_COMMANDS)
    repositoryBranchLinks.value = persistedState.repositoryBranchLinks
  }

  function savePinnedRepositories(repoPaths: string[]) {
    pinnedRepositoryPaths.value = repoPaths
    void window.appState.savePinnedRepositoryPaths(repoPaths).catch(showError)
  }

  function savePinnedScripts(scripts: PinnedScript[]) {
    pinnedScripts.value = scripts
    void window.appState.savePinnedScripts(scripts).catch(showError)
  }

  function saveRecentCommands(commandIds: string[]) {
    recentCommandIds.value = commandIds.slice(0, MAX_RECENT_COMMANDS)
    const savedCommandIds = [...recentCommandIds.value]

    void Promise.resolve()
      .then(() => window.appState.saveRecentCommandIds(savedCommandIds))
      .catch(showError)
  }

  function saveRepositoryBranchLinks(links: RepositoryBranchLink[]) {
    repositoryBranchLinks.value = links
    void window.appState.saveRepositoryBranchLinks(links).catch(showError)
  }

  function saveRepositoryBranchLink(link: Omit<RepositoryBranchLink, 'updatedAt'>) {
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

    saveRepositoryBranchLinks(nextLinks)
    showAppFeedback(`Linked ${savedLink.parentBranch} to ${savedLink.submoduleBranch}.`, 'info')
  }

  function removeRepositoryBranchLink(linkToRemove: Pick<RepositoryBranchLink, 'repoPath' | 'parentBranch' | 'submodulePath'>) {
    saveRepositoryBranchLinks(
      repositoryBranchLinks.value.filter((existingLink) =>
        existingLink.repoPath !== linkToRemove.repoPath ||
        existingLink.parentBranch !== linkToRemove.parentBranch ||
        existingLink.submodulePath !== linkToRemove.submodulePath
      ),
    )
    showAppFeedback(`Removed link for ${linkToRemove.parentBranch}.`, 'info')
  }

  function rememberCommand(commandId: string) {
    saveRecentCommands([
      commandId,
      ...recentCommandIds.value.filter((recentCommandId) => recentCommandId !== commandId),
    ])
  }

  function togglePinnedRepository(repoPath: string) {
    const repository = repositories.value.find((savedRepository) => savedRepository.path === repoPath)
    const repositoryName = repository?.name ?? repoPath
    const isPinned = pinnedRepositoryPaths.value.includes(repoPath)

    savePinnedRepositories(
      isPinned
        ? pinnedRepositoryPaths.value.filter((pinnedPath) => pinnedPath !== repoPath)
        : [repoPath, ...pinnedRepositoryPaths.value],
    )
    showAppFeedback(`${isPinned ? 'Unpinned' : 'Pinned'} ${repositoryName}.`, 'info')
  }

  function togglePinnedScript(scriptName: string) {
    if (!selectedDetails.value) {
      return
    }

    const command = selectedDetails.value.npmScripts[scriptName]

    if (!command) {
      return
    }

    const pinnedScript: PinnedScript = {
      repoPath: selectedDetails.value.path,
      repoName: selectedDetails.value.name,
      scriptName,
      command,
      packageManager: selectedDetails.value.packageManager,
    }
    const key = scriptReferenceKey(pinnedScript)
    const isPinned = pinnedScripts.value.some((script) => scriptReferenceKey(script) === key)

    savePinnedScripts(
      isPinned
        ? pinnedScripts.value.filter((script) => scriptReferenceKey(script) !== key)
        : [pinnedScript, ...pinnedScripts.value],
    )
    showAppFeedback(`${isPinned ? 'Unpinned' : 'Pinned'} ${scriptName}.`, 'info')
  }

  function unpinScript(scriptToUnpin: PinnedScript) {
    savePinnedScripts(
      pinnedScripts.value.filter((script) => scriptReferenceKey(script) !== scriptReferenceKey(scriptToUnpin)),
    )
    showAppFeedback(`Unpinned ${scriptToUnpin.scriptName}.`, 'info')
  }

  function removePinnedScriptsForRepository(repoPath: string) {
    savePinnedScripts(pinnedScripts.value.filter((script) => script.repoPath !== repoPath))
  }

  return {
    loadPersistedAppState,
    pinnedRepositoryPaths,
    pinnedScriptNamesForSelectedRepo,
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
