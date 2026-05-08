import { computed, ref, type Ref } from 'vue'
import type { MergeBranchRequest, MergeLinkedSubmoduleBranchRequest, RepositoryDetails } from '../repositories'
import type { AppSettings } from '../settings'
import type { AppFeedbackTone } from './useToasts'

const FEEDBACK_DISMISS_MS = 4000

type ConfirmAction = (options: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
}) => Promise<boolean>

interface UseRepositoryBranchActionsOptions {
  appSettings: Ref<AppSettings>
  clearError: () => void
  confirmAction: ConfirmAction
  loadRepositories: () => Promise<void>
  resetAutoRefreshTimer: () => void
  selectedDetails: Ref<RepositoryDetails | null>
  showAppFeedback: (message: string, tone?: AppFeedbackTone) => void
  showRepositoryError: (repoPath: string, title: string, error: unknown) => void
}

export function useRepositoryBranchActions({
  appSettings,
  clearError,
  confirmAction,
  loadRepositories,
  resetAutoRefreshTimer,
  selectedDetails,
  showAppFeedback,
  showRepositoryError,
}: UseRepositoryBranchActionsOptions) {
  const syncingBranchName = ref<string | null>(null)
  const syncingSubmoduleBranchName = ref<string | null>(null)
  const deletingBranchName = ref<string | null>(null)
  const deletingSubmoduleBranchName = ref<string | null>(null)
  const checkingOutBranchName = ref<string | null>(null)
  const checkingOutSubmoduleBranchName = ref<string | null>(null)
  const mergingBranchName = ref<string | null>(null)
  const mergingLinkedBranchName = ref<string | null>(null)
  const branchFeedbackMessages = ref<Record<string, string>>({})
  const syncCelebrationToken = ref(0)

  const currentBranch = computed(() =>
    selectedDetails.value?.gitBranches.find((branch) => branch.current),
  )

  function canSyncCurrentBranch() {
    if (!selectedDetails.value || !currentBranch.value) {
      return false
    }

    return (
      !syncingBranchName.value &&
      !deletingBranchName.value &&
      !branchSyncDisabledReason(currentBranch.value, selectedDetails.value.gitStatus)
    )
  }

  async function deleteBranch(branchName: string) {
    if (!selectedDetails.value) {
      return
    }

    const confirmed = await confirmAction({
      title: 'Remove local branch',
      message: `Remove "${branchName}" from ${selectedDetails.value.name}? This only deletes the local branch.`,
      confirmLabel: 'Remove branch',
      danger: true,
    })

    if (!confirmed) {
      return
    }

    deletingBranchName.value = branchName
    clearError()

    try {
      selectedDetails.value = await window.repositories.deleteBranch({
        repoPath: selectedDetails.value.path,
        branchName,
      })
      await loadRepositories()
      showAppFeedback(`Removed branch ${branchName}.`)
    } catch (error) {
      showRepositoryError(selectedDetails.value.path, `Could not remove branch "${branchName}"`, error)
    } finally {
      deletingBranchName.value = null
      resetAutoRefreshTimer()
    }
  }

  async function deleteSubmoduleBranch(submodulePath: string, branchName: string) {
    if (!selectedDetails.value) {
      return
    }

    const confirmed = await confirmAction({
      title: 'Remove local submodule branch',
      message: `Remove local branch "${branchName}" from submodule "${submodulePath}"? This does not delete a remote branch.`,
      confirmLabel: 'Remove branch',
      danger: true,
    })

    if (!confirmed) {
      return
    }

    deletingSubmoduleBranchName.value = `${submodulePath}:${branchName}`
    clearError()
    const repoPath = selectedDetails.value.path

    try {
      selectedDetails.value = await window.repositories.deleteSubmoduleBranch({
        repoPath,
        submodulePath,
        branchName,
      })
      await loadRepositories()
      showAppFeedback(`Removed local submodule branch ${branchName}.`)
    } catch (error) {
      showRepositoryError(repoPath, `Could not remove submodule branch "${branchName}"`, error)
    } finally {
      deletingSubmoduleBranchName.value = null
      resetAutoRefreshTimer()
    }
  }

  async function checkoutBranch(branchName: string) {
    if (!selectedDetails.value) {
      return
    }

    checkingOutBranchName.value = branchName
    clearError()
    const repoPath = selectedDetails.value.path

    try {
      selectedDetails.value = await window.repositories.checkoutBranch({
        repoPath,
        branchName,
      })
      await loadRepositories()
      showBranchFeedback(branchName, 'Checked out')
      showAppFeedback(`Checked out branch ${branchName}.`)
    } catch (error) {
      showRepositoryError(repoPath, `Could not check out branch "${branchName}"`, error)
    } finally {
      checkingOutBranchName.value = null
      resetAutoRefreshTimer()
    }
  }

  async function checkoutRemoteBranch(remoteBranchName: string) {
    if (!selectedDetails.value) {
      return
    }

    checkingOutBranchName.value = remoteBranchName
    clearError()
    const repoPath = selectedDetails.value.path

    try {
      selectedDetails.value = await window.repositories.checkoutRemoteBranch({
        repoPath,
        remoteBranchName,
      })
      await loadRepositories()
      showBranchFeedback(remoteBranchName, 'Created local branch')
      showAppFeedback(`Created branch from ${remoteBranchName}.`)
    } catch (error) {
      showRepositoryError(repoPath, `Could not create branch from "${remoteBranchName}"`, error)
    } finally {
      checkingOutBranchName.value = null
      resetAutoRefreshTimer()
    }
  }

  async function checkoutSubmoduleBranch(submodulePath: string, branchName: string) {
    if (!selectedDetails.value) {
      return
    }

    const checkoutKey = `${submodulePath}:${branchName}`
    checkingOutSubmoduleBranchName.value = checkoutKey
    clearError()
    const repoPath = selectedDetails.value.path

    try {
      selectedDetails.value = await window.repositories.checkoutSubmoduleBranch({
        repoPath,
        submodulePath,
        branchName,
      })
      await loadRepositories()
      showAppFeedback(`Checked out submodule branch ${branchName}.`)
    } catch (error) {
      showRepositoryError(repoPath, `Could not check out submodule branch "${branchName}"`, error)
    } finally {
      checkingOutSubmoduleBranchName.value = null
      resetAutoRefreshTimer()
    }
  }

  async function syncBranch(branchName: string) {
    if (!selectedDetails.value) {
      return
    }

    const branch = selectedDetails.value.gitBranches.find((entry) => entry.name === branchName)
    const action = branchSyncAction(branch)
    const confirmed = appSettings.value.skipBranchSyncConfirmation || (await confirmAction({
      title: action.confirmLabel,
      message: `${action.message} Repository: ${selectedDetails.value.name}.`,
      confirmLabel: action.confirmLabel,
    }))

    if (!confirmed) {
      return
    }

    syncingBranchName.value = branchName
    clearError()
    const repoPath = selectedDetails.value.path

    try {
      const syncResult = await window.repositories.syncBranch({
        repoPath,
        branchName,
      })
      selectedDetails.value = syncResult.details
      await loadRepositories()
      if (syncResult.pushed) {
        syncCelebrationToken.value += 1
      }
      showBranchFeedback(branchName, action.successLabel)
      showAppFeedback(`${action.toastVerb} branch ${branchName}.`)
    } catch (error) {
      showRepositoryError(repoPath, `Could not ${action.confirmLabel.toLowerCase()}`, error)
    } finally {
      syncingBranchName.value = null
      resetAutoRefreshTimer()
    }
  }

  async function syncSubmoduleBranch(submodulePath: string, branchName: string) {
    if (!selectedDetails.value) {
      return
    }

    const submodule = selectedDetails.value.gitSubmodules.find((entry) => entry.path === submodulePath)
    const branch = submodule?.branches.find((entry) => entry.name === branchName)
    const action = branchSyncAction(branch)
    const confirmed = appSettings.value.skipBranchSyncConfirmation || (await confirmAction({
      title: action.confirmLabel,
      message: `${action.message} Submodule: ${submodulePath}.`,
      confirmLabel: action.confirmLabel,
    }))

    if (!confirmed) {
      return
    }

    const syncKey = `${submodulePath}:${branchName}`
    syncingSubmoduleBranchName.value = syncKey
    clearError()
    const repoPath = selectedDetails.value.path

    try {
      const syncResult = await window.repositories.syncSubmoduleBranch({
        repoPath,
        submodulePath,
        branchName,
      })
      selectedDetails.value = syncResult.details
      await loadRepositories()
      if (syncResult.pushed) {
        syncCelebrationToken.value += 1
      }
      showAppFeedback(`${action.toastVerb} submodule branch ${branchName}.`)
    } catch (error) {
      showRepositoryError(repoPath, `Could not ${action.confirmLabel.toLowerCase()}`, error)
    } finally {
      syncingSubmoduleBranchName.value = null
      resetAutoRefreshTimer()
    }
  }

  async function mergeLinkedSubmoduleBranch(request: Omit<MergeLinkedSubmoduleBranchRequest, 'repoPath'>) {
    if (!selectedDetails.value) {
      return
    }

    const repoPath = selectedDetails.value.path
    const submoduleCount = request.routes.length
    const confirmed = await confirmAction({
      title: 'Merge linked branches',
      message: `Switch to "${request.targetParentBranch}", merge "${request.sourceParentBranch}" into it, then merge ${submoduleCount} linked submodule ${submoduleCount === 1 ? 'branch' : 'branches'}?`,
      confirmLabel: 'Merge branches',
    })

    if (!confirmed) {
      return
    }

    mergingLinkedBranchName.value = request.targetParentBranch
    clearError()

    try {
      selectedDetails.value = await window.repositories.mergeLinkedSubmoduleBranch({
        repoPath,
        ...request,
      })
      await loadRepositories()
      showBranchFeedback(request.targetParentBranch, 'Merged linked branches')
      showAppFeedback(`Merged ${request.sourceParentBranch} into ${request.targetParentBranch}.`)
    } catch (error) {
      showRepositoryError(repoPath, 'Could not merge linked branches', error)
    } finally {
      mergingLinkedBranchName.value = null
      resetAutoRefreshTimer()
    }
  }

  async function mergeBranch(request: Omit<MergeBranchRequest, 'repoPath'>) {
    if (!selectedDetails.value) {
      return
    }

    const repoPath = selectedDetails.value.path
    const confirmed = await confirmAction({
      title: 'Merge branches',
      message: `Switch to "${request.targetBranch}", then merge "${request.sourceBranch}" into it?`,
      confirmLabel: 'Merge',
    })

    if (!confirmed) {
      return
    }

    mergingBranchName.value = request.targetBranch
    clearError()

    try {
      selectedDetails.value = await window.repositories.mergeBranch({
        repoPath,
        ...request,
      })
      await loadRepositories()
      showBranchFeedback(request.targetBranch, 'Merged branch')
      showAppFeedback(`Merged ${request.sourceBranch} into ${request.targetBranch}.`)
    } catch (error) {
      showRepositoryError(repoPath, 'Could not merge branches', error)
    } finally {
      mergingBranchName.value = null
      resetAutoRefreshTimer()
    }
  }

  function showBranchFeedback(branchName: string, message: string) {
    branchFeedbackMessages.value = {
      ...branchFeedbackMessages.value,
      [branchName]: message,
    }

    window.setTimeout(() => {
      const nextFeedbackMessages = { ...branchFeedbackMessages.value }
      delete nextFeedbackMessages[branchName]
      branchFeedbackMessages.value = nextFeedbackMessages
    }, FEEDBACK_DISMISS_MS)
  }

  return {
    branchFeedbackMessages,
    canSyncCurrentBranch,
    checkingOutBranchName,
    checkingOutSubmoduleBranchName,
    checkoutBranch,
    checkoutRemoteBranch,
    checkoutSubmoduleBranch,
    currentBranch,
    deletingBranchName,
    deletingSubmoduleBranchName,
    deleteBranch,
    deleteSubmoduleBranch,
    mergeBranch,
    mergingBranchName,
    mergeLinkedSubmoduleBranch,
    mergingLinkedBranchName,
    syncBranch,
    syncCelebrationToken,
    syncingBranchName,
    syncingSubmoduleBranchName,
    syncSubmoduleBranch,
  }
}

function branchSyncAction(
  branch:
    | RepositoryDetails['gitBranches'][number]
    | RepositoryDetails['gitSubmodules'][number]['branches'][number]
    | undefined,
) {
  if (!branch) {
    return {
      confirmLabel: 'Sync branch',
      message: 'This will fetch first and sync the branch when possible.',
      successLabel: 'Synced',
      toastVerb: 'Synced',
    }
  }

  if (branch.ahead > 0 && branch.behind === 0) {
    return {
      confirmLabel: 'Push branch',
      message: `Push local commits from "${branch.name}" to ${branch.upstream}? This will fetch first and only push if the remote has no incoming commits.`,
      successLabel: 'Pushed',
      toastVerb: 'Pushed',
    }
  }

  if (branch.behind > 0 && branch.ahead === 0) {
    return {
      confirmLabel: 'Pull branch',
      message: `Pull commits from ${branch.upstream} into "${branch.name}"? This will only fast-forward the local branch.`,
      successLabel: 'Pulled',
      toastVerb: 'Pulled',
    }
  }

  return {
    confirmLabel: 'Sync branch',
    message: `Sync "${branch.name}" with ${branch.upstream}? This will fetch first and only continue when the branch can be fast-forwarded safely.`,
    successLabel: 'Synced',
    toastVerb: 'Synced',
  }
}

function hasStagedOrUnstagedChanges(gitStatus: RepositoryDetails['gitStatus']) {
  return (
    gitStatus.staged.length > 0 ||
    gitStatus.unstaged.length > 0 ||
    gitStatus.conflicted.length > 0
  )
}

function branchSyncDisabledReason(
  branch: RepositoryDetails['gitBranches'][number],
  gitStatus: RepositoryDetails['gitStatus'],
) {
  if (hasStagedOrUnstagedChanges(gitStatus)) {
    return 'Commit, stash, or discard staged and unstaged changes before syncing.'
  }

  if (!branch.upstream) {
    return 'No upstream remote branch is configured.'
  }

  if (branch.remoteGone) {
    return 'Upstream remote branch is gone.'
  }

  if (branch.ahead > 0 && branch.behind > 0) {
    return 'Branch has both local and remote commits. Resolve it manually before syncing.'
  }

  return undefined
}
