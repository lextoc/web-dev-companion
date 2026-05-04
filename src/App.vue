<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ActiveTerminalsSidebar from './components/ActiveTerminalsSidebar.vue'
import AppHeader from './components/AppHeader.vue'
import RepositoryDashboard from './components/RepositoryDashboard.vue'
import RepositoryDetail from './components/RepositoryDetail.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import TerminalModal from './components/TerminalModal.vue'
import type { RepositoryDetails, RepositorySummary, ScriptOutput, ScriptTerminal } from './repositories'
import { DEFAULT_APP_SETTINGS, type AppSettings } from './settings'

const FOCUS_REFRESH_THROTTLE_MS = 2000
const PINNED_REPOSITORIES_KEY = 'web-dev-companion:pinned-repositories'
const APP_SETTINGS_KEY = 'web-dev-companion:settings'
const MAX_ACTIVITY_ITEMS = 8

interface ConfirmationDialog {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  resolve: (confirmed: boolean) => void
}

interface AppFeedback {
  message: string
  tone: 'success' | 'info'
}

interface ActivityItem {
  id: string
  message: string
  time: string
  tone: AppFeedback['tone']
}

const repositories = ref<RepositorySummary[]>([])
const selectedPath = ref<string | null>(null)
const selectedDetails = ref<RepositoryDetails | null>(null)
const repoPathInput = ref('')
const errorMessage = ref('')
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
const areTerminalsCollapsed = ref(false)
const selectedTerminalRunId = ref<string | null>(null)
const isSettingsOpen = ref(false)
const confirmationDialog = ref<ConfirmationDialog | null>(null)
const appFeedback = ref<AppFeedback | null>(null)
const appSettings = ref<AppSettings>({ ...DEFAULT_APP_SETTINGS })
const pinnedRepositoryPaths = ref<string[]>([])
const activityItems = ref<ActivityItem[]>([])
const autoRefreshRemainingMs = ref(DEFAULT_APP_SETTINGS.autoRefreshIntervalMs)
const lastRepositoryListRefreshAt = ref<Date | null>(null)
const scriptTerminals = ref<Record<string, ScriptTerminal>>({})
let removeScriptOutputListener: (() => void) | undefined
let removeWindowFocusListener: (() => void) | undefined
let autoRefreshTickTimer: number | undefined
let statusFeedbackTimer: number | undefined
let appFeedbackTimer: number | undefined
let nextAutoRefreshAt = 0
let lastFocusRefreshAt = 0
const appOwnedRunIds = new Set<string>()

const selectedSummary = computed(() =>
  repositories.value.find((repository) => repository.path === selectedPath.value),
)

const npmScripts = computed(() => Object.entries(selectedDetails.value?.npmScripts ?? {}))
const hasRunningScripts = computed(() =>
  Object.values(scriptTerminals.value).some((terminal) => terminal.isRunning),
)
const activeTerminals = computed(() =>
  Object.values(scriptTerminals.value).sort((terminalA, terminalB) => {
    const repoComparison = terminalA.repoName.localeCompare(terminalB.repoName)

    if (repoComparison !== 0) {
      return repoComparison
    }

    return terminalA.scriptName.localeCompare(terminalB.scriptName)
  }),
)
const runningScriptsByRepositoryPath = computed(() => {
  const counts: Record<string, number> = {}

  for (const terminal of Object.values(scriptTerminals.value)) {
    if (!terminal.isRunning) {
      continue
    }

    counts[terminal.repoPath] = (counts[terminal.repoPath] ?? 0) + 1
  }

  return counts
})
const currentRepoScriptTerminals = computed(() => {
  if (!selectedDetails.value) {
    return {}
  }

  return Object.fromEntries(
    Object.values(scriptTerminals.value)
      .filter((terminal) => terminal.repoPath === selectedDetails.value?.path)
      .map((terminal) => [terminal.scriptName, terminal]),
  )
})
const selectedTerminal = computed(() =>
  selectedTerminalRunId.value ? scriptTerminals.value[selectedTerminalRunId.value] : undefined,
)
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

function normalizeError(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

function showAppFeedback(message: string, tone: AppFeedback['tone'] = 'success') {
  appFeedback.value = { message, tone }
  recordActivity(message, tone)

  if (appFeedbackTimer !== undefined) {
    window.clearTimeout(appFeedbackTimer)
  }

  appFeedbackTimer = window.setTimeout(() => {
    appFeedback.value = null
    appFeedbackTimer = undefined
  }, 4000)
}

function recordActivity(message: string, tone: AppFeedback['tone'] = 'success') {
  activityItems.value = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      message,
      tone,
      time: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    },
    ...activityItems.value,
  ].slice(0, MAX_ACTIVITY_ITEMS)
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

function savePinnedRepositories(repoPaths: string[]) {
  pinnedRepositoryPaths.value = repoPaths
  localStorage.setItem(PINNED_REPOSITORIES_KEY, JSON.stringify(repoPaths))
}

function applyThemeMode(themeMode: AppSettings['themeMode']) {
  if (themeMode === 'system') {
    document.documentElement.removeAttribute('data-theme')
    return
  }

  document.documentElement.dataset.theme = themeMode
}

function loadAppSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) ?? '{}') as Partial<AppSettings>
    const autoRefreshIntervalMs = Number(parsed.autoRefreshIntervalMs)

    appSettings.value = {
      autoRefreshIntervalMs: autoRefreshIntervalMs > 0
        ? autoRefreshIntervalMs
        : DEFAULT_APP_SETTINGS.autoRefreshIntervalMs,
      editorCommand: typeof parsed.editorCommand === 'string'
        ? parsed.editorCommand
        : DEFAULT_APP_SETTINGS.editorCommand,
      themeMode: parsed.themeMode === 'light' || parsed.themeMode === 'dark' || parsed.themeMode === 'system'
        ? parsed.themeMode
        : DEFAULT_APP_SETTINGS.themeMode,
    }
  } catch {
    appSettings.value = { ...DEFAULT_APP_SETTINGS }
  }

  applyThemeMode(appSettings.value.themeMode)
  autoRefreshRemainingMs.value = appSettings.value.autoRefreshIntervalMs
}

function saveAppSettings(settings: AppSettings) {
  appSettings.value = settings
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings))
  applyThemeMode(settings.themeMode)
  isSettingsOpen.value = false
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

function confirmAction(options: Omit<ConfirmationDialog, 'resolve'>) {
  return new Promise<boolean>((resolve) => {
    confirmationDialog.value = {
      ...options,
      resolve,
    }
  })
}

function closeConfirmation(confirmed: boolean) {
  const dialog = confirmationDialog.value

  if (!dialog) {
    return
  }

  confirmationDialog.value = null
  dialog.resolve(confirmed)
}

async function loadRepositories() {
  isLoading.value = true
  errorMessage.value = ''

  try {
    repositories.value = await window.repositories.list()
    lastRepositoryListRefreshAt.value = new Date()
  } catch (error) {
    errorMessage.value = normalizeError(error)
  } finally {
    isLoading.value = false
  }
}

async function chooseAndAddRepository() {
  isLoading.value = true
  errorMessage.value = ''

  try {
    repositories.value = await window.repositories.chooseAndAdd()
    lastRepositoryListRefreshAt.value = new Date()
  } catch (error) {
    errorMessage.value = normalizeError(error)
  } finally {
    isLoading.value = false
  }
}

async function addRepositoryByPath() {
  isLoading.value = true
  errorMessage.value = ''

  try {
    repositories.value = await window.repositories.addByPath(repoPathInput.value)
    lastRepositoryListRefreshAt.value = new Date()
    repoPathInput.value = ''
  } catch (error) {
    errorMessage.value = normalizeError(error)
  } finally {
    isLoading.value = false
  }
}

async function openRepository(repository: RepositorySummary) {
  selectedPath.value = repository.path
  await loadRepositoryDetails(repository.path)
}

async function loadRepositoryDetails(repoPath: string) {
  isDetailLoading.value = true
  errorMessage.value = ''

  try {
    selectedDetails.value = await window.repositories.details(repoPath)
  } catch (error) {
    selectedDetails.value = null
    errorMessage.value = normalizeError(error)
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
  errorMessage.value = ''

  try {
    selectedDetails.value = await window.repositories.deleteBranch({
      repoPath: selectedDetails.value.path,
      branchName,
    })
    await loadRepositories()
    showStatusFeedback(`Removed ${branchName}.`)
    showAppFeedback(`Removed branch ${branchName}.`)
  } catch (error) {
    errorMessage.value = normalizeError(error)
  } finally {
    deletingBranchName.value = null
    resetAutoRefreshTimer()
  }
}

async function syncBranch(branchName: string) {
  if (!selectedDetails.value) {
    return
  }

  const confirmed = await confirmAction({
    title: 'Sync branch',
    message: `Sync "${branchName}" in ${selectedDetails.value.name}? This will fetch/pull and fast-forward the local branch when possible.`,
    confirmLabel: 'Sync branch',
  })

  if (!confirmed) {
    return
  }

  syncingBranchName.value = branchName
  errorMessage.value = ''

  try {
    selectedDetails.value = await window.repositories.syncBranch({
      repoPath: selectedDetails.value.path,
      branchName,
    })
    await loadRepositories()
    showBranchFeedback(branchName, 'Synced')
    showAppFeedback(`Synced branch ${branchName}.`)
  } catch (error) {
    errorMessage.value = normalizeError(error)
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
  errorMessage.value = ''

  try {
    selectedDetails.value = await action()
    await loadRepositories()
    showStatusFeedback(successMessage)
    showAppFeedback(successMessage)
    return true
  } catch (error) {
    errorMessage.value = normalizeError(error)
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
  errorMessage.value = ''

  try {
    repositories.value = await window.repositories.remove(repoPath)

    if (selectedPath.value === repoPath) {
      selectedPath.value = null
      selectedDetails.value = null
    }

    showAppFeedback(`Removed ${repositoryName}.`)
  } catch (error) {
    errorMessage.value = normalizeError(error)
  } finally {
    isLoading.value = false
  }
}

async function openRepositoryInFileManager(repoPath: string) {
  errorMessage.value = ''

  try {
    await window.repositories.openInFileManager({ repoPath })
    showAppFeedback('Opened repository folder.', 'info')
  } catch (error) {
    errorMessage.value = normalizeError(error)
  }
}

async function openRepositoryInEditor(repoPath: string) {
  errorMessage.value = ''

  try {
    await window.repositories.openInEditor({
      repoPath,
      editorCommand: appSettings.value.editorCommand,
    })
    showAppFeedback('Opened repository in editor.', 'info')
  } catch (error) {
    errorMessage.value = normalizeError(error)
  }
}

async function openRepositoryInTerminal(repoPath: string) {
  errorMessage.value = ''

  try {
    await window.repositories.openInTerminal({ repoPath })
    showAppFeedback('Opened repository terminal.', 'info')
  } catch (error) {
    errorMessage.value = normalizeError(error)
  }
}

async function copyRepositoryPath(repoPath: string) {
  try {
    await navigator.clipboard.writeText(repoPath)
    showAppFeedback('Copied repository path.', 'info')
  } catch {
    errorMessage.value = 'Could not copy repository path.'
  }
}

function closeDetails() {
  stopAutoRefreshTimer()
  selectedPath.value = null
  selectedDetails.value = null
  hasCommitDraft.value = false
}

function stopOwnedScripts() {
  if (appOwnedRunIds.size > 0) {
    window.repositories.stopScripts([...appOwnedRunIds])
  }

  appOwnedRunIds.clear()
  scriptTerminals.value = {}
}

function handleScriptOutput(output: ScriptOutput) {
  const terminal = scriptTerminals.value[output.runId]

  if (!terminal) {
    return
  }

  scriptTerminals.value[output.runId] = {
    ...terminal,
    output: `${terminal.output}${output.text}`,
    isRunning: output.done ? false : terminal.isRunning,
  }

  if (output.done) {
    appOwnedRunIds.delete(output.runId)
  }
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

async function startTerminal(
  repoPath: string,
  repoName: string,
  scriptName: string,
  packageManager?: string,
) {
  try {
    const scriptRun = await window.repositories.startScript({
      repoPath,
      scriptName,
      packageManager,
    })

    appOwnedRunIds.add(scriptRun.runId)
    scriptTerminals.value = {
      ...scriptTerminals.value,
      [scriptRun.runId]: {
        runId: scriptRun.runId,
        repoPath,
        repoName,
        scriptName,
        command: scriptRun.command,
        output: `$ ${scriptRun.command}\n`,
        isRunning: true,
      },
    }

    return scriptRun.runId
  } catch (error) {
    errorMessage.value = normalizeError(error)
    return undefined
  }
}

async function runScript(scriptName: string) {
  if (!selectedDetails.value || currentRepoScriptTerminals.value[scriptName]) {
    return
  }

  errorMessage.value = ''

  await startTerminal(
    selectedDetails.value.path,
    selectedDetails.value.name,
    scriptName,
    selectedDetails.value.packageManager,
  )
}

async function stopScript(scriptName: string) {
  const terminal = currentRepoScriptTerminals.value[scriptName]

  if (!terminal) {
    return
  }

  await stopTerminal(terminal.runId)
}

async function restartScript(scriptName: string) {
  const terminal = currentRepoScriptTerminals.value[scriptName]

  if (!terminal) {
    await runScript(scriptName)
    return
  }

  await restartTerminal(terminal.runId)
}

async function restartTerminal(runId: string) {
  const terminal = scriptTerminals.value[runId]

  if (!terminal) {
    return
  }

  errorMessage.value = ''

  if (terminal.isRunning) {
    await window.repositories.stopScript(terminal.runId)
  }

  appOwnedRunIds.delete(terminal.runId)
  const nextTerminals = { ...scriptTerminals.value }
  delete nextTerminals[terminal.runId]
  scriptTerminals.value = nextTerminals

  const newRunId = await startTerminal(terminal.repoPath, terminal.repoName, terminal.scriptName)

  if (newRunId && selectedTerminalRunId.value === runId) {
    selectedTerminalRunId.value = newRunId
  } else if (!newRunId && selectedTerminalRunId.value === runId) {
    selectedTerminalRunId.value = null
  }
}

function openScriptTerminal(scriptName: string) {
  const terminal = currentRepoScriptTerminals.value[scriptName]

  if (terminal) {
    selectedTerminalRunId.value = terminal.runId
  }
}

function openTerminal(runId: string) {
  if (scriptTerminals.value[runId]) {
    selectedTerminalRunId.value = runId
  }
}

function closeTerminalModal() {
  selectedTerminalRunId.value = null
}

async function stopTerminal(runId: string) {
  const terminal = scriptTerminals.value[runId]

  if (!terminal) {
    return
  }

  if (terminal.isRunning) {
    await window.repositories.stopScript(terminal.runId)
  }

  appOwnedRunIds.delete(terminal.runId)
  const nextTerminals = { ...scriptTerminals.value }
  delete nextTerminals[terminal.runId]
  scriptTerminals.value = nextTerminals

  if (selectedTerminalRunId.value === terminal.runId) {
    selectedTerminalRunId.value = null
  }
}

function handlePageExit() {
  if (statusFeedbackTimer !== undefined) {
    window.clearTimeout(statusFeedbackTimer)
    statusFeedbackTimer = undefined
  }

  if (appFeedbackTimer !== undefined) {
    window.clearTimeout(appFeedbackTimer)
    appFeedbackTimer = undefined
  }

  closeConfirmation(false)
  closeTerminalModal()
  stopAutoRefreshTimer()
  stopOwnedScripts()
}

onMounted(() => {
  loadAppSettings()
  loadPinnedRepositories()
  removeScriptOutputListener = window.repositories.onScriptOutput(handleScriptOutput)
  removeWindowFocusListener = window.repositories.onWindowFocus(() => {
    void refreshOnWindowFocus()
  })
  window.addEventListener('pagehide', handlePageExit)
  window.addEventListener('beforeunload', handlePageExit)
  void loadRepositories()
})

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', handlePageExit)
  window.removeEventListener('beforeunload', handlePageExit)
  handlePageExit()
  removeScriptOutputListener?.()
  removeWindowFocusListener?.()
})
</script>

<template>
  <main class="app-shell">
    <AppHeader :repository-count="repositories.length" @settings="isSettingsOpen = true" />

    <div class="app-layout" :class="{ 'terminals-collapsed': areTerminalsCollapsed }">
      <div class="main-pane">
        <RepositoryDashboard
          v-if="!selectedPath"
          v-model:repo-path-input="repoPathInput"
          :repositories="repositories"
          :pinned-repository-paths="pinnedRepositoryPaths"
          :running-scripts-by-repository-path="runningScriptsByRepositoryPath"
          :last-refreshed-label="lastRepositoryRefreshLabel"
          :is-loading="isLoading"
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
        :activity-items="activityItems"
        :collapsed="areTerminalsCollapsed"
        @toggle="areTerminalsCollapsed = !areTerminalsCollapsed"
        @stop="stopTerminal"
        @restart="restartTerminal"
        @open="openTerminal"
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
