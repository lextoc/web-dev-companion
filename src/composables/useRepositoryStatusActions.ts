import { nextTick, ref, type Ref } from 'vue'
import type { RepositoryDetails } from '../repositories'
import type { AppFeedbackTone } from './useToasts'

type ReadableRef<T> = {
  readonly value: T
}

interface UseRepositoryStatusActionsOptions {
  clearError: () => void
  isDetailLoading: ReadableRef<boolean>
  isLoading: ReadableRef<boolean>
  loadRepositories: () => Promise<void>
  resetAutoRefreshTimer: () => void
  selectedDetails: Ref<RepositoryDetails | null>
  showAppFeedback: (message: string, tone?: AppFeedbackTone) => void
  showRepositoryError: (repoPath: string, title: string, error: unknown) => void
}

export function useRepositoryStatusActions({
  clearError,
  isDetailLoading,
  isLoading,
  loadRepositories,
  resetAutoRefreshTimer,
  selectedDetails,
  showAppFeedback,
  showRepositoryError,
}: UseRepositoryStatusActionsOptions) {
  const statusActionLabel = ref<string | null>(null)
  const pendingStatusActionKey = ref<string | null>(null)
  const commitClearToken = ref(0)
  const hasCommitDraft = ref(false)

  async function runStatusAction(
    actionLabel: string,
    actionKey: string,
    successMessage: string,
    action: () => Promise<RepositoryDetails>,
  ) {
    if (!selectedDetails.value) {
      return false
    }

    statusActionLabel.value = actionLabel
    pendingStatusActionKey.value = actionKey
    clearError()
    const repoPath = selectedDetails.value.path

    try {
      selectedDetails.value = await action()
      await loadRepositories()
      showAppFeedback(successMessage)
      return true
    } catch (error) {
      showRepositoryError(repoPath, successMessage.replace(/\.$/, ' failed.'), error)
      return false
    } finally {
      statusActionLabel.value = null
      pendingStatusActionKey.value = null
      resetAutoRefreshTimer()
    }
  }

  async function stageFiles(request: { paths: string[]; actionKey: string }) {
    if (!selectedDetails.value) {
      return false
    }

    const repoPath = selectedDetails.value.path
    return runStatusAction(
      'Staging files...',
      request.actionKey,
      `Staged ${request.paths.length} file${request.paths.length === 1 ? '' : 's'}.`,
      () =>
        window.repositories.stageFiles({
          repoPath,
          paths: request.paths,
        }),
    )
  }

  async function stageAllChanges() {
    if (!selectedDetails.value || pendingStatusActionKey.value || isLoading.value || isDetailLoading.value) {
      return
    }

    const paths = [
      ...selectedDetails.value.gitStatus.unstaged,
      ...selectedDetails.value.gitStatus.untracked,
      ...selectedDetails.value.gitStatus.conflicted,
    ].map((entry) => entry.path)
    const uniquePaths = [...new Set(paths)]

    if (uniquePaths.length === 0) {
      return
    }

    const staged = await stageFiles({
      paths: uniquePaths,
      actionKey: `stage:${uniquePaths.join('\n')}`,
    })

    if (staged) {
      await focusCommitMessageInput()
    }
  }

  async function unstageAllChanges() {
    if (!selectedDetails.value || pendingStatusActionKey.value || isLoading.value || isDetailLoading.value) {
      return
    }

    const paths = selectedDetails.value.gitStatus.staged.map((entry) => entry.path)
    const uniquePaths = [...new Set(paths)]

    if (uniquePaths.length === 0) {
      return
    }

    await unstageFiles({
      paths: uniquePaths,
      actionKey: `unstage:${uniquePaths.join('\n')}`,
    })
  }

  async function unstageFiles(request: { paths: string[]; actionKey: string }) {
    if (!selectedDetails.value) {
      return
    }

    const repoPath = selectedDetails.value.path
    await runStatusAction(
      'Unstaging files...',
      request.actionKey,
      `Unstaged ${request.paths.length} file${request.paths.length === 1 ? '' : 's'}.`,
      () =>
        window.repositories.unstageFiles({
          repoPath,
          paths: request.paths,
        }),
    )
  }

  async function commitStatus(message: string) {
    if (!selectedDetails.value) {
      return
    }

    const repoPath = selectedDetails.value.path
    const didCommit = await runStatusAction(
      'Committing...',
      'commit',
      'Committed staged changes.',
      () =>
        window.repositories.commit({
          repoPath,
          message,
        }),
    )

    if (didCommit) {
      commitClearToken.value += 1
      hasCommitDraft.value = false
    }
  }

  function updateCommitDraft(hasDraft: boolean) {
    hasCommitDraft.value = hasDraft
  }

  return {
    commitClearToken,
    commitStatus,
    hasCommitDraft,
    pendingStatusActionKey,
    stageAllChanges,
    stageFiles,
    statusActionLabel,
    unstageAllChanges,
    unstageFiles,
    updateCommitDraft,
  }
}

async function focusCommitMessageInput() {
  await nextTick()
  document.getElementById('commit-message')?.focus()
}
