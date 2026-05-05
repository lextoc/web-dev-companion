<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ActiveTerminalsSidebar from './components/ActiveTerminalsSidebar.vue'
import AppHeader from './components/AppHeader.vue'
import RepositoryDashboard from './components/RepositoryDashboard.vue'
import RepositoryDetail from './components/RepositoryDetail.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import TerminalModal from './components/TerminalModal.vue'
import { useConfirmations } from './composables/useConfirmations'
import { useSettings } from './composables/useSettings'
import { useTerminals } from './composables/useTerminals'
import { useToasts } from './composables/useToasts'
import type { PinnedScript, RepositoryDetails, RepositoryGitLogEntry, RepositorySummary } from './repositories'
import type { AppSettings } from './settings'

const FOCUS_REFRESH_THROTTLE_MS = 2000
const PINNED_REPOSITORIES_KEY = 'web-dev-companion:pinned-repositories'
const PINNED_SCRIPTS_KEY = 'web-dev-companion:pinned-scripts'

type AppHistoryState =
  | { view: 'dashboard' }
  | { view: 'repository'; repoPath: string }

const repositories = ref<RepositorySummary[]>([])
const selectedPath = ref<string | null>(null)
const selectedDetails = ref<RepositoryDetails | null>(null)
const repoPathInput = ref('')
const isLoading = ref(false)
const isDetailLoading = ref(false)
const syncingBranchName = ref<string | null>(null)
const deletingBranchName = ref<string | null>(null)
const statusActionLabel = ref<string | null>(null)
const pendingStatusActionKey = ref<string | null>(null)
const statusFeedbackMessage = ref<string | null>(null)
const branchFeedbackMessages = ref<Record<string, string>>({})
const commitClearToken = ref(0)
const hasCommitDraft = ref(false)
const pinnedRepositoryPaths = ref<string[]>([])
const pinnedScripts = ref<PinnedScript[]>([])
const lastRepositoryListRefreshAt = ref<Date | null>(null)
const dashboardGitLogEntries = ref<RepositoryGitLogEntry[]>([])
const isDashboardGitLogLoading = ref(false)
let removeScriptOutputListener: (() => void) | undefined
let removeWindowFocusListener: (() => void) | undefined
let autoRefreshTickTimer: number | undefined
let statusFeedbackTimer: number | undefined
let nextAutoRefreshAt = 0
let lastFocusRefreshAt = 0
let dashboardGitLogRequestId = 0

const {
  activityItems,
  appFeedback,
  clearError,
  cleanupToasts,
  errorMessage,
  showAppFeedback,
  showError,
} = useToasts()
const { confirmationDialog, confirmAction, closeConfirmation } = useConfirmations()
const { appSettings, isSettingsOpen, loadAppSettings, saveAppSettings: persistAppSettings } = useSettings()
const autoRefreshRemainingMs = ref(appSettings.value.autoRefreshIntervalMs)

const selectedSummary = computed(() =>
  repositories.value.find((repository) => repository.path === selectedPath.value),
)

const npmScripts = computed(() => Object.entries(selectedDetails.value?.npmScripts ?? {}))
const pinnedScriptNamesForSelectedRepo = computed(() => {
  if (!selectedDetails.value) {
    return []
  }

  return pinnedScripts.value
    .filter((script) => script.repoPath === selectedDetails.value?.path)
    .map((script) => script.scriptName)
})
const {
  activeTerminals,
  areTerminalsCollapsed,
  closeTerminalModal,
  currentRepoScriptTerminals,
  handleScriptOutput,
  hasRunningScripts,
  openScriptTerminal,
  openTerminal,
  restartScript,
  restartTerminal,
  runRepositoryScript,
  runningScriptsByRepositoryPath,
  runScript,
  selectedTerminal,
  stopOwnedScripts,
  stopScript,
  stopTerminal,
} = useTerminals({ clearError, selectedDetails, showError })
const autoRefreshProgress = computed(() =>
  Math.max(0, Math.min(100, (autoRefreshRemainingMs.value / appSettings.value.autoRefreshIntervalMs) * 100)),
)
const autoRefreshLabel = computed(() => {
  const totalSeconds = Math.ceil(autoRefreshRemainingMs.value / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')} until auto refresh`
})
const lastRepositoryRefreshLabel = computed(() => {
  if (!lastRepositoryListRefreshAt.value) {
    return ''
  }

  return `Updated ${lastRepositoryListRefreshAt.value.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`
})
const appActivityLabel = computed(() => {
  if (statusActionLabel.value) {
    return statusActionLabel.value
  }

  if (syncingBranchName.value) {
    return `Syncing ${syncingBranchName.value}...`
  }

  if (deletingBranchName.value) {
    return `Removing ${deletingBranchName.value}...`
  }

  if (isDetailLoading.value) {
    return 'Refreshing repository...'
  }

  if (isLoading.value) {
    return 'Refreshing repositories...'
  }

  return null
})

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
  stopAutoRefreshTimer()
  selectedPath.value = null
  selectedDetails.value = null
  hasCommitDraft.value = false
  void loadDashboardGitLog()
}

async function applyHistoryState(state: AppHistoryState | undefined) {
  if (!state || state.view === 'dashboard') {
    showDashboard()
    return
  }

  selectedPath.value = state.repoPath
  await loadRepositoryDetails(state.repoPath)
}

async function loadDashboardGitLog(repositoryList = repositories.value) {
  const requestId = dashboardGitLogRequestId + 1
  dashboardGitLogRequestId = requestId
  isDashboardGitLogLoading.value = true

  try {
    const detailResults = await Promise.allSettled(
      repositoryList.map((repository) => window.repositories.details(repository.path)),
    )

    if (dashboardGitLogRequestId !== requestId || selectedPath.value) {
      return
    }

    dashboardGitLogEntries.value = detailResults
      .flatMap((result) => {
        if (result.status !== 'fulfilled') {
          return []
        }

        return result.value.gitLog.slice(0, 6).map((entry) => ({
          ...entry,
          repoPath: result.value.path,
          repoName: result.value.name,
        }))
      })
      .sort((entryA, entryB) => Date.parse(entryB.dateTime) - Date.parse(entryA.dateTime))
      .slice(0, 18)
  } finally {
    if (dashboardGitLogRequestId === requestId) {
      isDashboardGitLogLoading.value = false
    }
  }
}

function loadPinnedRepositories() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_REPOSITORIES_KEY) ?? '[]')
    pinnedRepositoryPaths.value = Array.isArray(parsed)
      ? parsed.filter((repoPath): repoPath is string => typeof repoPath === 'string')
      : []
  } catch {
    pinnedRepositoryPaths.value = []
  }
}

function loadPinnedScripts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_SCRIPTS_KEY) ?? '[]')

    pinnedScripts.value = Array.isArray(parsed)
      ? parsed.filter((script): script is PinnedScript =>
        typeof script?.repoPath === 'string' &&
        typeof script?.repoName === 'string' &&
        typeof script?.scriptName === 'string' &&
        typeof script?.command === 'string' &&
        (script.packageManager === undefined || typeof script.packageManager === 'string'),
      )
      : []
  } catch {
    pinnedScripts.value = []
  }
}

function savePinnedRepositories(repoPaths: string[]) {
  pinnedRepositoryPaths.value = repoPaths
  localStorage.setItem(PINNED_REPOSITORIES_KEY, JSON.stringify(repoPaths))
}

function savePinnedScripts(scripts: PinnedScript[]) {
  pinnedScripts.value = scripts
  localStorage.setItem(PINNED_SCRIPTS_KEY, JSON.stringify(scripts))
}

function pinnedScriptKey(script: Pick<PinnedScript, 'repoPath' | 'scriptName'>) {
  return `${script.repoPath}\n${script.scriptName}`
}

function saveAppSettings(settings: AppSettings) {
  persistAppSettings(settings)
  showAppFeedback('Settings saved.')

  if (selectedPath.value) {
    resetAutoRefreshTimer()
  }
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
  const key = pinnedScriptKey(pinnedScript)
  const isPinned = pinnedScripts.value.some((script) => pinnedScriptKey(script) === key)

  savePinnedScripts(
    isPinned
      ? pinnedScripts.value.filter((script) => pinnedScriptKey(script) !== key)
      : [pinnedScript, ...pinnedScripts.value],
  )
  showAppFeedback(`${isPinned ? 'Unpinned' : 'Pinned'} ${scriptName}.`, 'info')
}

function unpinScript(scriptToUnpin: PinnedScript) {
  savePinnedScripts(
    pinnedScripts.value.filter((script) => pinnedScriptKey(script) !== pinnedScriptKey(scriptToUnpin)),
  )
  showAppFeedback(`Unpinned ${scriptToUnpin.scriptName}.`, 'info')
}

async function startPinnedScript(script: PinnedScript) {
  await runRepositoryScript(script)
}

async function loadRepositories() {
  isLoading.value = true
  clearError()

  try {
    repositories.value = await window.repositories.list()
    lastRepositoryListRefreshAt.value = new Date()

    if (!selectedPath.value) {
      void loadDashboardGitLog(repositories.value)
    }
  } catch (error) {
    showError(error)
  } finally {
    isLoading.value = false
  }
}

async function chooseAndAddRepository() {
  isLoading.value = true
  clearError()

  try {
    repositories.value = await window.repositories.chooseAndAdd()
    lastRepositoryListRefreshAt.value = new Date()
    void loadDashboardGitLog(repositories.value)
  } catch (error) {
    showError(error)
  } finally {
    isLoading.value = false
  }
}

async function addRepositoryByPath() {
  isLoading.value = true
  clearError()

  try {
    repositories.value = await window.repositories.addByPath(repoPathInput.value)
    lastRepositoryListRefreshAt.value = new Date()
    repoPathInput.value = ''
    void loadDashboardGitLog(repositories.value)
  } catch (error) {
    showError(error)
  } finally {
    isLoading.value = false
  }
}

async function openRepository(repository: RepositorySummary) {
  const historyState = currentHistoryState()

  if (historyState?.view !== 'repository' || historyState.repoPath !== repository.path) {
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
    showError(error)
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

async function refreshOnWindowFocus() {
  const now = Date.now()

  if (now - lastFocusRefreshAt < FOCUS_REFRESH_THROTTLE_MS) {
    return
  }

  if (
    isLoading.value ||
    isDetailLoading.value ||
    pendingStatusActionKey.value ||
    syncingBranchName.value ||
    deletingBranchName.value ||
    hasRunningScripts.value ||
    hasCommitDraft.value
  ) {
    return
  }

  lastFocusRefreshAt = now

  if (selectedPath.value) {
    await refreshSelectedRepository()
    return
  }

  await loadRepositories()
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
    showStatusFeedback(`Removed ${branchName}.`)
    showAppFeedback(`Removed branch ${branchName}.`)
  } catch (error) {
    showError(error)
  } finally {
    deletingBranchName.value = null
    resetAutoRefreshTimer()
  }
}

function branchSyncAction(branch: RepositoryDetails['gitBranches'][number] | undefined) {
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

async function syncBranch(branchName: string) {
  if (!selectedDetails.value) {
    return
  }

  const branch = selectedDetails.value.gitBranches.find((entry) => entry.name === branchName)
  const action = branchSyncAction(branch)
  const confirmed = await confirmAction({
    title: action.confirmLabel,
    message: `${action.message} Repository: ${selectedDetails.value.name}.`,
    confirmLabel: action.confirmLabel,
  })

  if (!confirmed) {
    return
  }

  syncingBranchName.value = branchName
  clearError()

  try {
    selectedDetails.value = await window.repositories.syncBranch({
      repoPath: selectedDetails.value.path,
      branchName,
    })
    await loadRepositories()
    showBranchFeedback(branchName, action.successLabel)
    showAppFeedback(`${action.toastVerb} branch ${branchName}.`)
  } catch (error) {
    showError(error)
  } finally {
    syncingBranchName.value = null
    resetAutoRefreshTimer()
  }
}

function showStatusFeedback(message: string) {
  statusFeedbackMessage.value = message

  if (statusFeedbackTimer !== undefined) {
    window.clearTimeout(statusFeedbackTimer)
  }

  statusFeedbackTimer = window.setTimeout(() => {
    statusFeedbackMessage.value = null
    statusFeedbackTimer = undefined
  }, 4000)
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
  }, 4000)
}

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
  statusFeedbackMessage.value = null
  clearError()

  try {
    selectedDetails.value = await action()
    await loadRepositories()
    showStatusFeedback(successMessage)
    showAppFeedback(successMessage)
    return true
  } catch (error) {
    showError(error)
    return false
  } finally {
    statusActionLabel.value = null
    pendingStatusActionKey.value = null
    resetAutoRefreshTimer()
  }
}

async function stageFiles(request: { paths: string[]; actionKey: string }) {
  if (!selectedDetails.value) {
    return
  }

  const repoPath = selectedDetails.value.path
  await runStatusAction(
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

async function removeRepository(repoPath: string) {
  const repository = repositories.value.find((savedRepository) => savedRepository.path === repoPath)
  const repositoryName = repository?.name ?? repoPath

  const confirmed = await confirmAction({
    title: 'Remove repository',
    message: `Remove "${repositoryName}" from Web Dev Companion? The repository folder will stay on disk.`,
    confirmLabel: 'Remove repository',
    danger: true,
  })

  if (!confirmed) {
    return
  }

  isLoading.value = true
  clearError()

  try {
    repositories.value = await window.repositories.remove(repoPath)
    savePinnedScripts(pinnedScripts.value.filter((script) => script.repoPath !== repoPath))
    void loadDashboardGitLog(repositories.value)

    if (selectedPath.value === repoPath) {
      selectedPath.value = null
      selectedDetails.value = null
    }

    showAppFeedback(`Removed ${repositoryName}.`)
  } catch (error) {
    showError(error)
  } finally {
    isLoading.value = false
  }
}

async function openRepositoryInFileManager(repoPath: string) {
  clearError()

  try {
    await window.repositories.openInFileManager({ repoPath })
    showAppFeedback('Opened repository folder.', 'info')
  } catch (error) {
    showError(error)
  }
}

async function openRepositoryInEditor(repoPath: string) {
  clearError()

  try {
    await window.repositories.openInEditor({
      repoPath,
      editorCommand: appSettings.value.editorCommand,
    })
    showAppFeedback('Opened repository in editor.', 'info')
  } catch (error) {
    showError(error)
  }
}

async function openRepositoryInTerminal(repoPath: string) {
  clearError()

  try {
    await window.repositories.openInTerminal({ repoPath })
    showAppFeedback('Opened repository terminal.', 'info')
  } catch (error) {
    showError(error)
  }
}

async function copyRepositoryPath(repoPath: string) {
  try {
    await navigator.clipboard.writeText(repoPath)
    showAppFeedback('Copied repository path.', 'info')
  } catch {
    showError(new Error('Could not copy repository path.'))
  }
}

function closeDetails() {
  if (currentHistoryState()?.view === 'repository' && window.history.length > 1) {
    window.history.back()
    return
  }

  replaceHistoryState({ view: 'dashboard' })
  showDashboard()
}

function updateAutoRefreshCountdown() {
  if (!selectedPath.value) {
    stopAutoRefreshTimer()
    return
  }

  const remainingMs = nextAutoRefreshAt - Date.now()
  autoRefreshRemainingMs.value = Math.max(0, remainingMs)

  if (remainingMs > 0 || isDetailLoading.value) {
    return
  }

  if (hasRunningScripts.value || hasCommitDraft.value) {
    resetAutoRefreshTimer()
    return
  }

  void refreshSelectedRepository()
}

function resetAutoRefreshTimer() {
  nextAutoRefreshAt = Date.now() + appSettings.value.autoRefreshIntervalMs
  autoRefreshRemainingMs.value = appSettings.value.autoRefreshIntervalMs

  if (autoRefreshTickTimer === undefined) {
    autoRefreshTickTimer = window.setInterval(updateAutoRefreshCountdown, 1000)
  }
}

function stopAutoRefreshTimer() {
  if (autoRefreshTickTimer !== undefined) {
    window.clearInterval(autoRefreshTickTimer)
    autoRefreshTickTimer = undefined
  }

  nextAutoRefreshAt = 0
  autoRefreshRemainingMs.value = appSettings.value.autoRefreshIntervalMs
}

function updateCommitDraft(hasDraft: boolean) {
  hasCommitDraft.value = hasDraft
}

function handlePageExit() {
  if (statusFeedbackTimer !== undefined) {
    window.clearTimeout(statusFeedbackTimer)
    statusFeedbackTimer = undefined
  }

  cleanupToasts()
  closeConfirmation(false)
  closeTerminalModal()
  stopAutoRefreshTimer()
  stopOwnedScripts()
}

function handleHistoryNavigation(event: PopStateEvent) {
  void applyHistoryState(event.state as AppHistoryState | undefined)
}

onMounted(() => {
  document.documentElement.dataset.platform = navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other'
  replaceHistoryState({ view: 'dashboard' })
  loadAppSettings()
  autoRefreshRemainingMs.value = appSettings.value.autoRefreshIntervalMs
  loadPinnedRepositories()
  loadPinnedScripts()
  removeScriptOutputListener = window.repositories.onScriptOutput(handleScriptOutput)
  removeWindowFocusListener = window.repositories.onWindowFocus(() => {
    void refreshOnWindowFocus()
  })
  window.addEventListener('popstate', handleHistoryNavigation)
  window.addEventListener('pagehide', handlePageExit)
  window.addEventListener('beforeunload', handlePageExit)
  void loadRepositories()
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', handleHistoryNavigation)
  window.removeEventListener('pagehide', handlePageExit)
  window.removeEventListener('beforeunload', handlePageExit)
  handlePageExit()
  removeScriptOutputListener?.()
  removeWindowFocusListener?.()
})
</script>

<template>
  <main class="app-shell">
    <AppHeader
      :repository-count="repositories.length"
      :active-repository-name="selectedDetails?.name ?? selectedSummary?.name"
      :active-repository-path="selectedDetails?.path ?? selectedSummary?.path"
      :activity-label="appActivityLabel"
      :active-script-count="activeTerminals.length"
      @settings="isSettingsOpen = true"
    />

    <div class="app-layout" :class="{ 'terminals-collapsed': areTerminalsCollapsed }">
      <div class="main-pane">
        <RepositoryDashboard
          v-if="!selectedPath"
          v-model:repo-path-input="repoPathInput"
          :repositories="repositories"
          :pinned-repository-paths="pinnedRepositoryPaths"
          :running-scripts-by-repository-path="runningScriptsByRepositoryPath"
          :mixed-git-log="dashboardGitLogEntries"
          :last-refreshed-label="lastRepositoryRefreshLabel"
          :is-loading="isLoading"
          :is-git-log-loading="isDashboardGitLogLoading"
          @add="addRepositoryByPath"
          @browse="chooseAndAddRepository"
          @open="openRepository"
          @remove="removeRepository"
          @toggle-pin="togglePinnedRepository"
          @copy-path="copyRepositoryPath"
          @open-in-editor="openRepositoryInEditor"
          @open-in-file-manager="openRepositoryInFileManager"
          @open-in-terminal="openRepositoryInTerminal"
        />

        <RepositoryDetail
          v-else
          :selected-details="selectedDetails"
          :selected-summary="selectedSummary"
          :is-detail-loading="isDetailLoading"
          :auto-refresh-label="autoRefreshLabel"
          :auto-refresh-progress="autoRefreshProgress"
          :syncing-branch-name="syncingBranchName"
          :deleting-branch-name="deletingBranchName"
          :status-action-label="statusActionLabel"
          :pending-status-action-key="pendingStatusActionKey"
          :status-feedback-message="statusFeedbackMessage"
          :branch-feedback-messages="branchFeedbackMessages"
          :commit-clear-token="commitClearToken"
          :npm-scripts="npmScripts"
          :pinned-script-names="pinnedScriptNamesForSelectedRepo"
          :script-terminals-by-script="currentRepoScriptTerminals"
          @back="closeDetails"
          @refresh="refreshSelectedRepository"
          @delete-branch="deleteBranch"
          @sync-branch="syncBranch"
          @stage-files="stageFiles"
          @unstage-files="unstageFiles"
          @commit="commitStatus"
          @commit-draft-change="updateCommitDraft"
          @run-script="runScript"
          @toggle-pin-script="togglePinnedScript"
          @stop-script="stopScript"
          @restart-script="restartScript"
          @open-terminal="openScriptTerminal"
          @copy-path="copyRepositoryPath"
          @open-in-editor="openRepositoryInEditor"
          @open-in-file-manager="openRepositoryInFileManager"
          @open-in-terminal="openRepositoryInTerminal"
        />
      </div>

      <ActiveTerminalsSidebar
        :terminals="activeTerminals"
        :pinned-scripts="pinnedScripts"
        :activity-items="activityItems"
        :collapsed="areTerminalsCollapsed"
        @toggle="areTerminalsCollapsed = !areTerminalsCollapsed"
        @stop="stopTerminal"
        @restart="restartTerminal"
        @open="openTerminal"
        @start-pinned="startPinnedScript"
        @unpin-pinned="unpinScript"
      />
    </div>

    <TerminalModal
      v-if="selectedTerminal"
      :terminal="selectedTerminal"
      @close="closeTerminalModal"
      @stop="stopTerminal"
      @restart="restartTerminal"
    />

    <SettingsPanel
      v-if="isSettingsOpen"
      :settings="appSettings"
      @close="isSettingsOpen = false"
      @save="saveAppSettings"
    />

    <div
      v-if="confirmationDialog"
      class="modal-backdrop"
      role="presentation"
      @click.self="closeConfirmation(false)"
    >
      <section
        class="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h2 id="confirm-title">{{ confirmationDialog.title }}</h2>
        <p>{{ confirmationDialog.message }}</p>
        <div class="confirm-actions">
          <button type="button" class="secondary" @click="closeConfirmation(false)">
            Cancel
          </button>
          <button
            type="button"
            :class="{ danger: confirmationDialog.danger }"
            @click="closeConfirmation(true)"
          >
            {{ confirmationDialog.confirmLabel }}
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="appActivityLabel || appFeedback || errorMessage"
      class="toast-stack"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        v-if="appActivityLabel || appFeedback"
        class="toast-message"
        :class="appActivityLabel ? 'info' : (appFeedback?.tone ?? 'info')"
        role="status"
      >
        <span v-if="appActivityLabel" class="activity-dot" aria-hidden="true"></span>
        <span>{{ appActivityLabel ?? appFeedback?.message }}</span>
      </div>

      <div v-if="errorMessage" class="toast-message error" role="alert">
        <span>{{ errorMessage }}</span>
        <button type="button" class="toast-close" @click="errorMessage = ''">
          Dismiss
        </button>
      </div>
    </div>
  </main>
</template>
