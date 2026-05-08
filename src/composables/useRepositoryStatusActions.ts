import { nextTick, ref, type Ref } from 'vue'
import type { RepositoryDetails } from '../repositories'
import type { AppFeedbackTone } from './useToasts'

type ReadableRef<T> = {
  readonly value: T
}

type ConfirmAction = (options: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
}) => Promise<boolean>

interface UseRepositoryStatusActionsOptions {
  clearError: () => void
  confirmAction: ConfirmAction
  isDetailLoading: ReadableRef<boolean>
  isLoading: ReadableRef<boolean>
  loadRepositories: () => Promise<void>
  resetAutoRefreshTimer: () => void
  runHealthScriptsBeforeCommit?: (repository: RepositoryDetails, taskIds: string[]) => Promise<unknown>
  selectedDetails: Ref<RepositoryDetails | null>
  showAppFeedback: (message: string, tone?: AppFeedbackTone) => void
  showRepositoryError: (repoPath: string, title: string, error: unknown) => void
}

interface CommitStatusRequest {
  checkHealthBeforeCommit?: boolean
  healthTaskIds?: string[]
  message: string
}

export function useRepositoryStatusActions({
  clearError,
  confirmAction,
  isDetailLoading,
  isLoading,
  loadRepositories,
  resetAutoRefreshTimer,
  runHealthScriptsBeforeCommit,
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

  async function resetTrackedChanges(paths?: string[]) {
    if (!selectedDetails.value || pendingStatusActionKey.value || isLoading.value || isDetailLoading.value) {
      return
    }

    const { gitStatus, name, path: repoPath } = selectedDetails.value
    const uniquePaths = paths ? [...new Set(paths.map((statusPath) => statusPath.trim()).filter(Boolean))] : []
    const trackedChangeCount = gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.conflicted.length

    if (uniquePaths.length === 0 && trackedChangeCount === 0) {
      return
    }

    const fileLabel = uniquePaths.length === 1
      ? `"${uniquePaths[0]}"`
      : `${uniquePaths.length} files`
    const selectedPathLabel = uniquePaths.length === 1 ? 'the selected path' : 'the selected paths'
    const message = uniquePaths.length > 0
      ? `Run git reset for ${fileLabel} in ${name}? This discards tracked staged and unstaged changes for ${selectedPathLabel}. Untracked files stay on disk.`
      : `Run git reset --hard HEAD in ${name}? This discards tracked staged and unstaged changes. Untracked files stay on disk.`

    const confirmed = await confirmAction({
      title: 'Git reset',
      message,
      confirmLabel: 'Git reset',
      danger: true,
    })

    if (!confirmed) {
      return
    }

    await runStatusAction(
      'Resetting tracked changes...',
      `git-reset:${uniquePaths.join('\n') || 'all'}`,
      uniquePaths.length > 0
        ? `Reset ${uniquePaths.length} file${uniquePaths.length === 1 ? '' : 's'}.`
        : 'Reset tracked changes.',
      () =>
        window.repositories.resetTrackedChanges({
          repoPath,
          paths: uniquePaths.length > 0 ? uniquePaths : undefined,
        }),
    )
  }

  async function commitStatus(request: string | CommitStatusRequest) {
    if (!selectedDetails.value) {
      return
    }

    const commitRequest = typeof request === 'string'
      ? { message: request }
      : request
    const repoPath = selectedDetails.value.path
    const healthTaskIds = commitRequest.healthTaskIds ?? []

    if (commitRequest.checkHealthBeforeCommit && healthTaskIds.length > 0) {
      if (!runHealthScriptsBeforeCommit) {
        showRepositoryError(repoPath, 'Health check failed.', new Error('Health checks are not available.'))
        return
      }

      statusActionLabel.value = 'Checking health...'
      pendingStatusActionKey.value = 'commit-health'
      clearError()

      try {
        await runHealthScriptsBeforeCommit(selectedDetails.value, healthTaskIds)
      } catch (error) {
        showRepositoryError(repoPath, 'Health check failed.', error)
        return
      } finally {
        statusActionLabel.value = null
        pendingStatusActionKey.value = null
        resetAutoRefreshTimer()
      }
    }

    const didCommit = await runStatusAction(
      'Committing...',
      'commit',
      'Committed staged changes.',
      () =>
        window.repositories.commit({
          repoPath,
          message: commitRequest.message,
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
    resetTrackedChanges,
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
