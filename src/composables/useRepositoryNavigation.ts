import { computed, ref, type Ref } from 'vue'
import type { RepositoryDetails, RepositorySummary } from '../repositories'

type AppHistoryState =
  | { view: 'dashboard' }
  | { view: 'repository'; repoPath: string }

interface UseRepositoryNavigationOptions {
  clearError: () => void
  clearCommitDraft: () => void
  loadRepositories: () => Promise<void>
  resetAutoRefreshTimer: () => void
  showRepositoryError: (repoPath: string, title: string, error: unknown) => void
}

export function useRepositoryNavigation({
  clearError,
  clearCommitDraft,
  loadRepositories,
  resetAutoRefreshTimer,
  showRepositoryError,
}: UseRepositoryNavigationOptions) {
  const selectedPath = ref<string | null>(null)
  const selectedDetails = ref<RepositoryDetails | null>(null)
  const isDetailLoading = ref(false)

  function selectedSummaryFrom(repositories: Ref<RepositorySummary[]>) {
    return computed(() =>
      repositories.value.find((repository) => repository.path === selectedPath.value),
    )
  }

  function currentHistoryState() {
    const state = window.history.state

    if (state?.view === 'repository' && typeof state.repoPath === 'string') {
      return state as AppHistoryState
    }

    if (state?.view === 'dashboard') {
      return state as AppHistoryState
    }

    return undefined
  }

  function replaceHistoryState(state: AppHistoryState) {
    window.history.replaceState(state, '')
  }

  function pushHistoryState(state: AppHistoryState) {
    window.history.pushState(state, '')
  }

  function showDashboard() {
    selectedPath.value = null
    selectedDetails.value = null
    clearCommitDraft()
    resetAutoRefreshTimer()
  }

  async function applyHistoryState(state: AppHistoryState | undefined) {
    if (!state || state.view === 'dashboard') {
      showDashboard()
      return
    }

    selectedPath.value = state.repoPath
    await loadRepositoryDetails(state.repoPath)
  }

  async function openRepository(repository: RepositorySummary) {
    const historyState = currentHistoryState()

    if (historyState?.view === 'repository' && historyState.repoPath !== repository.path) {
      replaceHistoryState({ view: 'repository', repoPath: repository.path })
    } else if (historyState?.view !== 'repository' || historyState.repoPath !== repository.path) {
      pushHistoryState({ view: 'repository', repoPath: repository.path })
    }

    selectedPath.value = repository.path
    await loadRepositoryDetails(repository.path)
  }

  async function loadRepositoryDetails(repoPath: string) {
    isDetailLoading.value = true
    clearError()

    try {
      selectedDetails.value = await window.repositories.details(repoPath)
    } catch (error) {
      selectedDetails.value = null
      showRepositoryError(repoPath, 'Could not load repository details', error)
    } finally {
      isDetailLoading.value = false

      if (selectedPath.value === repoPath) {
        resetAutoRefreshTimer()
      }
    }
  }

  async function refreshSelectedRepository() {
    if (!selectedPath.value) {
      return
    }

    await loadRepositories()
    await loadRepositoryDetails(selectedPath.value)
  }

  function closeDetails() {
    if (currentHistoryState()?.view === 'repository' && window.history.length > 1) {
      window.history.back()
      return
    }

    replaceHistoryState({ view: 'dashboard' })
    showDashboard()
  }

  function handleHistoryNavigation(event: PopStateEvent) {
    void applyHistoryState(event.state as AppHistoryState | undefined)
  }

  return {
    applyHistoryState,
    closeDetails,
    handleHistoryNavigation,
    isDetailLoading,
    loadRepositoryDetails,
    openRepository,
    refreshSelectedRepository,
    replaceHistoryState,
    selectedDetails,
    selectedPath,
    selectedSummaryFrom,
    showDashboard,
  }
}
