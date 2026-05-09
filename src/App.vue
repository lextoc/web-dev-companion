<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ActiveTerminalsSidebar, CommandPalette, KeybindingsSheet, SettingsPanel, TerminalModal } from './components/app'
import { RepositoryDashboard, RepositoryDetail } from './components/repository'
import { RepositoryHeaderControls } from './components/repository/header'
import { AppButton, AppHeader } from './components/ui'
import { useCommandPalette } from './composables/useCommandPalette'
import { useConfirmations } from './composables/useConfirmations'
import { usePersistedAppState } from './composables/usePersistedAppState'
import { useRepositoryAutoRefresh } from './composables/useRepositoryAutoRefresh'
import { useRepositoryBranchActions } from './composables/useRepositoryBranchActions'
import { useRepositoryNavigation } from './composables/useRepositoryNavigation'
import { useRepositoryStatusActions } from './composables/useRepositoryStatusActions'
import { useSettings } from './composables/useSettings'
import { useTerminals } from './composables/useTerminals'
import { useToasts } from './composables/useToasts'
import { KEYBINDINGS, keybindingLabel, type KeybindingPlatform } from './keybindings'
import type {
  DesktopMenuCommand,
  GitHubRepositorySummary,
  GitCommandLogEntry,
  PinnedScript,
  ProjectTask,
  RepositorySummary,
} from './repositories'
import type { AppSettings } from './settings'
import type { AppUpdateState } from './updates'

const MAX_GIT_COMMAND_LOG_ENTRIES = 80
type RepositoryDetailTab = 'git' | 'log' | 'health' | 'scripts'

const repositories = ref<RepositorySummary[]>([])
const localRepositoryCandidates = ref<RepositorySummary[]>([])
const githubRepositories = ref<GitHubRepositorySummary[]>([])
const repoPathInput = ref('')
const isLoading = ref(false)
const isRefreshingRepositories = ref(false)
const isScanningLocalRepositories = ref(false)
const hasScannedLocalRepositories = ref(false)
const localRepositoryScanError = ref('')
const isLoadingGitHubRepositories = ref(false)
const hasLoadedGitHubRepositories = ref(false)
const cloningGitHubRepositoryName = ref('')
const githubRepositoriesError = ref('')
const lastRepositoryListRefreshAt = ref<Date | null>(null)
const isMacPlatform = ref(false)
const isKeybindingsOpen = ref(false)
const gitCommandLog = ref<GitCommandLogEntry[]>([])
const branchShortcutTriggerToken = ref(0)
const activeRepositoryDetailTab = ref<RepositoryDetailTab>('git')
const appUpdateState = ref<AppUpdateState | null>(null)
let removeScriptOutputListener: (() => void) | undefined
let removeGitCommandListener: (() => void) | undefined
let removeWindowFocusListener: (() => void) | undefined
let removeMenuCommandListener: (() => void) | undefined
let removeAppUpdateListener: (() => void) | undefined

const {
  appToasts,
  clearError,
  cleanupToasts,
  dismissToast,
  errorMessage,
  holdToast,
  releaseToast,
  showAppFeedback,
  showError,
} = useToasts()
const { confirmationDialog, confirmAction, closeConfirmation } = useConfirmations()
const { appSettings, isSettingsOpen, loadAppSettings, saveAppSettings: persistAppSettings } = useSettings()
const {
  closeDetails,
  handleHistoryNavigation,
  isDetailLoading,
  openRepository,
  refreshSelectedRepository,
  replaceHistoryState,
  selectedDetails,
  selectedPath,
  selectedSummaryFrom,
} = useRepositoryNavigation({
  clearError,
  clearCommitDraft: () => updateCommitDraft(false),
  loadRepositories,
  resetAutoRefreshTimer: () => resetAutoRefreshTimer(),
  showRepositoryError,
})
const selectedSummary = selectedSummaryFrom(repositories)

const projectTasks = computed(() => selectedDetails.value?.projectTasks ?? [])
const {
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
} = usePersistedAppState({
  repositories,
  selectedDetails,
  showAppFeedback,
  showError,
})
const {
  activeTerminals,
  closeTerminalModal,
  currentRepoScriptTerminals,
  handleScriptOutput,
  hasRunningScripts,
  openScriptTerminal,
  openTerminal,
  restartScript,
  restartTerminal,
  runRepositoryScript,
  runRepositoryScriptsAndWait,
  runningScriptsByRepositoryPath,
  runScript,
  selectedTerminal,
  stopOwnedScripts,
  stopScript,
  stopTerminal,
} = useTerminals({ clearError, selectedDetails, showError })
const {
  commitClearToken,
  commitStatus,
  hasCommitDraft,
  pendingStatusActionKey,
  resetTrackedChanges,
  stageAllChanges,
  stageFiles,
  statusActionLabel,
  unstageAllChanges,
  unstageFiles,
  updateCommitDraft,
} = useRepositoryStatusActions({
  clearError,
  confirmAction,
  isDetailLoading,
  isLoading,
  loadRepositories,
  resetAutoRefreshTimer: () => resetAutoRefreshTimer(),
  runHealthScriptsBeforeCommit: runRepositoryScriptsAndWait,
  selectedDetails,
  showAppFeedback,
  showRepositoryError,
})
const {
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
} = useRepositoryBranchActions({
  appSettings,
  clearError,
  confirmAction,
  loadRepositories,
  resetAutoRefreshTimer: () => resetAutoRefreshTimer(),
  selectedDetails,
  showAppFeedback,
  showRepositoryError,
})
const {
  autoRefreshLabel,
  autoRefreshProgress,
  refreshOnWindowFocus,
  resetAutoRefreshTimer,
  stopAutoRefreshTimer,
  syncAutoRefreshInterval,
} = useRepositoryAutoRefresh({
  appSettings,
  checkingOutSubmoduleBranchName,
  deletingBranchName,
  deletingSubmoduleBranchName,
  hasCommitDraft,
  hasRunningScripts,
  isDetailLoading,
  isLoading,
  loadRepositories,
  mergingBranchName,
  mergingLinkedBranchName,
  pendingStatusActionKey,
  refreshSelectedRepository,
  selectedPath,
  syncingBranchName,
  syncingSubmoduleBranchName,
})
const {
  closeCommandPalette,
  commandPaletteItems,
  isCommandPaletteOpen,
  openCommandPalette,
  runCommandPaletteItem,
} = useCommandPalette({
  activeTerminals,
  chooseAndAddRepository,
  copyRepositoryPath,
  hasRunningScripts,
  isMacPlatform,
  isSettingsOpen,
  loadRepositories,
  openKeybindingsSheet,
  openRepository,
  openRepositoryInEditor,
  openRepositoryInFileManager,
  openRepositoryInTerminal,
  openTerminal,
  pinnedScripts,
  recentCommandIds,
  refreshSelectedRepository,
  rememberCommand,
  repositories,
  runRepositoryScript,
  runScript,
  selectedDetails,
  selectedPath,
  selectedSummary,
  showAppFeedback,
  stopOwnedScripts,
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
const keybindingPlatform = computed<KeybindingPlatform>(() => (isMacPlatform.value ? 'mac' : 'other'))
const commandShortcutLabel = computed(() =>
  keybindingLabel('command-palette', keybindingPlatform.value),
)
const settingsShortcutLabel = computed(() =>
  keybindingLabel('settings', keybindingPlatform.value),
)
const dashboardShortcutLabel = computed(() =>
  keybindingLabel('dashboard', keybindingPlatform.value),
)
const branchShortcutLabel = computed(() =>
  keybindingLabel('branch-switcher', keybindingPlatform.value),
)
const commitShortcutLabel = computed(() =>
  keybindingLabel('commit', keybindingPlatform.value),
)
const stageAllShortcutLabel = computed(() =>
  keybindingLabel('stage-all', keybindingPlatform.value),
)
const unstageAllShortcutLabel = computed(() =>
  keybindingLabel('unstage-all', keybindingPlatform.value),
)
const syncShortcutLabel = computed(() =>
  keybindingLabel('sync-branch', keybindingPlatform.value),
)
const appUpdateBannerVisible = computed(() =>
  ['available', 'downloading', 'downloaded'].includes(appUpdateState.value?.status ?? ''),
)
const appUpdateVersion = computed(() => appUpdateState.value?.update?.version ?? '')
const appUpdateDownloadPercent = computed(() =>
  Math.max(0, Math.min(100, Math.round(appUpdateState.value?.downloadPercent ?? 0))),
)
const appUpdateBannerMessage = computed(() => {
  if (!appUpdateState.value) {
    return ''
  }

  if (appUpdateState.value.status === 'downloaded') {
    return `Version ${appUpdateVersion.value} is ready to install.`
  }

  if (appUpdateState.value.status === 'downloading') {
    return `Downloading version ${appUpdateVersion.value} (${appUpdateDownloadPercent.value}%).`
  }

  return `Version ${appUpdateVersion.value} is available.`
})
const appUpdateActionLabel = computed(() =>
  appUpdateState.value?.status === 'downloaded' ? 'Restart to update' : 'Update Web Dev Companion',
)
const appUpdateActionDisabled = computed(() => appUpdateState.value?.status === 'downloading')

async function saveAppSettings(settings: AppSettings) {
  try {
    await persistAppSettings(settings)
    showAppFeedback('Settings saved.')
    resetAutoRefreshTimer()
  } catch (error) {
    showError(error)
  }
}

function showRepositoryError(_repoPath: string, _title: string, error: unknown) {
  showError(error)
}

function githubRepositoryErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not load GitHub repositories.'
}

function localRepositoryScanErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not scan for local repositories.'
}

function activeRepositoryPath() {
  return selectedDetails.value?.path ?? selectedSummary.value?.path
}

async function startPinnedScript(script: PinnedScript) {
  await runRepositoryScript(script)
}

async function openRepositoryScriptsTab(repoPath: string) {
  if (selectedPath.value === repoPath) {
    activeRepositoryDetailTab.value = 'scripts'
    return
  }

  const repository = repositories.value.find((savedRepository) => savedRepository.path === repoPath)

  if (!repository) {
    showRepositoryError(
      repoPath,
      'Could not open repository scripts',
      new Error('Repository is no longer in the saved repository list.'),
    )
    return
  }

  await openRepository(repository)
  activeRepositoryDetailTab.value = 'scripts'
}

function togglePinnedTask(task: ProjectTask) {
  void togglePinnedScript(task)
}

function openKeybindingsSheet() {
  closeCommandPalette()
  isKeybindingsOpen.value = true
}

function closeKeybindingsSheet() {
  isKeybindingsOpen.value = false
}

async function loadRepositories() {
  isLoading.value = true
  isRefreshingRepositories.value = true
  clearError()

  try {
    repositories.value = await window.repositories.list()
    lastRepositoryListRefreshAt.value = new Date()
  } catch (error) {
    showError(error)
  } finally {
    isLoading.value = false
    isRefreshingRepositories.value = false

    if (!selectedPath.value) {
      resetAutoRefreshTimer()
    }
  }
}

async function loadGitHubRepositories() {
  isLoadingGitHubRepositories.value = true
  githubRepositoriesError.value = ''
  clearError()

  try {
    githubRepositories.value = await window.repositories.listGitHubRepositories()
    hasLoadedGitHubRepositories.value = true
  } catch (error) {
    githubRepositoriesError.value = githubRepositoryErrorMessage(error)
  } finally {
    isLoadingGitHubRepositories.value = false
  }
}

async function chooseAndAddRepository() {
  isLoading.value = true
  clearError()

  try {
    repositories.value = await window.repositories.chooseAndAdd()
    lastRepositoryListRefreshAt.value = new Date()
  } catch (error) {
    showError(error)
  } finally {
    isLoading.value = false
  }
}

async function scanLocalRepositories() {
  isScanningLocalRepositories.value = true
  localRepositoryScanError.value = ''
  clearError()

  try {
    localRepositoryCandidates.value = await window.repositories.scanLocalRepositories()
    hasScannedLocalRepositories.value = true
  } catch (error) {
    localRepositoryScanError.value = localRepositoryScanErrorMessage(error)
  } finally {
    isScanningLocalRepositories.value = false
  }
}

async function cloneGitHubRepository(nameWithOwner: string) {
  isLoading.value = true
  cloningGitHubRepositoryName.value = nameWithOwner
  clearError()

  try {
    const savedPaths = new Set(repositories.value.map((repository) => repository.path))
    const nextRepositories = await window.repositories.cloneGitHubRepository(nameWithOwner)
    const clonedRepository = nextRepositories.find((repository) => !savedPaths.has(repository.path))

    repositories.value = nextRepositories
    lastRepositoryListRefreshAt.value = new Date()

    if (clonedRepository) {
      showAppFeedback(`Cloned ${clonedRepository.name}.`)
    }
  } catch (error) {
    showError(error)
  } finally {
    isLoading.value = false
    cloningGitHubRepositoryName.value = ''
  }
}

async function addRepositoryByPath() {
  isLoading.value = true
  clearError()

  try {
    repositories.value = await window.repositories.addByPath(repoPathInput.value)
    lastRepositoryListRefreshAt.value = new Date()
    repoPathInput.value = ''
  } catch (error) {
    showError(error)
  } finally {
    isLoading.value = false
  }
}

async function addScannedLocalRepository(repoPath: string) {
  isLoading.value = true
  clearError()

  try {
    repositories.value = await window.repositories.addByPath(repoPath)
    localRepositoryCandidates.value = localRepositoryCandidates.value.filter((repository) => repository.path !== repoPath)
    lastRepositoryListRefreshAt.value = new Date()
    showAppFeedback('Added repository.')
  } catch (error) {
    showError(error)
  } finally {
    isLoading.value = false
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
    await removePinnedScriptsForRepository(repoPath)

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
    showRepositoryError(repoPath, 'Could not open repository folder', error)
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
    showRepositoryError(repoPath, 'Could not open repository in editor', error)
  }
}

async function openRepositoryInTerminal(repoPath: string) {
  clearError()

  try {
    await window.repositories.openInTerminal({ repoPath })
    showAppFeedback('Opened repository terminal.', 'info')
  } catch (error) {
    showRepositoryError(repoPath, 'Could not open repository terminal', error)
  }
}

async function openCommitInBrowser(hash: string) {
  if (!selectedDetails.value) {
    return
  }

  const repoPath = selectedDetails.value.path
  clearError()

  try {
    await window.repositories.openCommitInBrowser({ repoPath, hash })
    showAppFeedback('Opened commit in browser.', 'info')
  } catch (error) {
    showRepositoryError(repoPath, `Could not open commit ${hash}`, error)
  }
}

async function runAppUpdateAction() {
  if (!appUpdateState.value || appUpdateState.value.status === 'downloading') {
    return
  }

  try {
    const nextState =
      appUpdateState.value.status === 'downloaded'
        ? await window.updates.install()
        : await window.updates.download()

    appUpdateState.value = nextState

    if (nextState.status === 'error') {
      showError(new Error(nextState.error ?? 'Could not update Web Dev Companion.'))
    }
  } catch (error) {
    showError(error)
  }
}

async function checkForAppUpdates() {
  try {
    showAppFeedback('Checking for updates...', 'info')

    const nextState = await window.updates.check()
    appUpdateState.value = nextState

    if (nextState.status === 'unsupported') {
      showAppFeedback('Update checks are available in packaged macOS and Windows builds.', 'info')
      return
    }

    if (nextState.status === 'not-available') {
      showAppFeedback('Web Dev Companion is up to date.', 'success')
      return
    }

    if (nextState.status === 'available' && nextState.update?.version) {
      showAppFeedback(`Version ${nextState.update.version} is available.`, 'info')
      return
    }

    if (nextState.status === 'downloaded' && nextState.update?.version) {
      showAppFeedback(`Version ${nextState.update.version} is ready to install.`, 'info')
      return
    }

    if (nextState.status === 'error') {
      showError(new Error(nextState.error ?? 'Could not check for updates.'))
    }
  } catch (error) {
    showError(error)
  }
}

async function handleMenuCommand(command: DesktopMenuCommand) {
  if (command === 'settings') {
    isSettingsOpen.value = true
    return
  }

  if (command === 'check-for-updates') {
    await checkForAppUpdates()
    return
  }

  if (command === 'keyboard-shortcuts') {
    openKeybindingsSheet()
    return
  }

  if (command === 'add-repository') {
    await chooseAndAddRepository()
    return
  }

  if (command === 'dashboard') {
    if (selectedPath.value) {
      closeDetails()
    }

    return
  }

  if (command === 'refresh') {
    if (selectedPath.value) {
      await refreshSelectedRepository()
      return
    }

    await loadRepositories()
    return
  }

  if (command === 'stop-scripts') {
    stopOwnedScripts()
    showAppFeedback('Stopped running tasks.', 'info')
    return
  }

  const repoPath = activeRepositoryPath()

  if (!repoPath) {
    return
  }

  if (command === 'open-in-editor') {
    await openRepositoryInEditor(repoPath)
  } else if (command === 'open-in-file-manager') {
    await openRepositoryInFileManager(repoPath)
  } else if (command === 'open-in-terminal') {
    await openRepositoryInTerminal(repoPath)
  }
}

function syncDesktopMenuState() {
  void window.desktop.setMenuState({
    hasRepositoryDetail: Boolean(selectedPath.value),
    hasRunningScripts: hasRunningScripts.value,
  })
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  )
}

async function copyRepositoryPath(repoPath: string) {
  try {
    await navigator.clipboard.writeText(repoPath)
    showAppFeedback('Copied repository path.', 'info')
  } catch {
    showRepositoryError(repoPath, 'Could not copy repository path', new Error('Could not copy repository path.'))
  }
}

function handlePageExit() {
  cleanupToasts()
  closeConfirmation(false)
  closeTerminalModal()
  closeKeybindingsSheet()
  stopAutoRefreshTimer()
  stopOwnedScripts()
}

function handleGitCommandLog(entry: GitCommandLogEntry) {
  gitCommandLog.value = [...gitCommandLog.value, entry].slice(-MAX_GIT_COMMAND_LOG_ENTRIES)
}

function handleGlobalKeydown(event: KeyboardEvent) {
  const key = event.key.toLowerCase()

  if (
    (event.metaKey || event.ctrlKey) &&
    key === '/' &&
    !event.altKey &&
    !event.shiftKey
  ) {
    event.preventDefault()
    openKeybindingsSheet()
    return
  }

  if (
    selectedPath.value &&
    !isCommandPaletteOpen.value &&
    !isKeybindingsOpen.value &&
    !selectedTerminal.value &&
    !confirmationDialog.value &&
    !isSettingsOpen.value &&
    (
      (isMacPlatform.value && event.metaKey && key === '1' && !event.ctrlKey && !event.altKey && !event.shiftKey) ||
      (!isMacPlatform.value && event.ctrlKey && key === '1' && !event.metaKey && !event.altKey && !event.shiftKey)
    )
  ) {
    event.preventDefault()
    closeDetails()
    return
  }

  if (
    (event.metaKey || event.ctrlKey) &&
    key === 's' &&
    !event.altKey &&
    !event.shiftKey
  ) {
    event.preventDefault()

    if (
      canSyncCurrentBranch() &&
      !isCommandPaletteOpen.value &&
      !isKeybindingsOpen.value &&
      !selectedTerminal.value &&
      !confirmationDialog.value &&
      !isSettingsOpen.value &&
      currentBranch.value
    ) {
      void syncBranch(currentBranch.value.name)
    }

    return
  }

  if (
    (event.metaKey || event.ctrlKey) &&
    key === 'a' &&
    !event.altKey &&
    !isEditableTarget(event.target)
  ) {
    if (
      selectedDetails.value &&
      !isCommandPaletteOpen.value &&
      !isKeybindingsOpen.value &&
      !selectedTerminal.value &&
      !confirmationDialog.value &&
      !isSettingsOpen.value
    ) {
      event.preventDefault()
      if (event.shiftKey) {
        void unstageAllChanges()
      } else {
        void stageAllChanges()
      }
    }

    return
  }

  if ((event.metaKey || event.ctrlKey) && key === 'k') {
    event.preventDefault()
    closeKeybindingsSheet()
    openCommandPalette()
    return
  }

  if (
    (event.metaKey || event.ctrlKey) &&
    key === 'b' &&
    !event.altKey &&
    !event.shiftKey &&
    !isEditableTarget(event.target)
  ) {
    if (
      selectedDetails.value &&
      !isCommandPaletteOpen.value &&
      !isKeybindingsOpen.value &&
      !selectedTerminal.value &&
      !confirmationDialog.value &&
      !isSettingsOpen.value
    ) {
      event.preventDefault()
      branchShortcutTriggerToken.value += 1
    }

    return
  }

  if (event.key === '/' && !isKeybindingsOpen.value && !isEditableTarget(event.target)) {
    event.preventDefault()
    openCommandPalette()
    return
  }

  if (event.key !== 'Escape') {
    return
  }

  if (isCommandPaletteOpen.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    closeCommandPalette()
    return
  }

  if (isKeybindingsOpen.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    closeKeybindingsSheet()
    return
  }

  if (selectedTerminal.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    closeTerminalModal()
    return
  }

  if (confirmationDialog.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    closeConfirmation(false)
    return
  }

  if (isSettingsOpen.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    isSettingsOpen.value = false
    return
  }

}

onMounted(async () => {
  const platformName = navigator.platform.toLowerCase()
  isMacPlatform.value = platformName.includes('mac')
  document.documentElement.dataset.platform = isMacPlatform.value
    ? 'mac'
    : platformName.includes('win')
      ? 'windows'
      : 'other'
  replaceHistoryState({ view: 'dashboard' })
  await loadAppSettings()
  syncAutoRefreshInterval()
  try {
    await loadPersistedAppState()
  } catch (error) {
    showError(error)
  }
  removeScriptOutputListener = window.repositories.onScriptOutput(handleScriptOutput)
  removeGitCommandListener = window.repositories.onGitCommand(handleGitCommandLog)
  removeWindowFocusListener = window.repositories.onWindowFocus(() => {
    void refreshOnWindowFocus()
  })
  removeMenuCommandListener = window.desktop.onMenuCommand((command) => {
    void handleMenuCommand(command)
  })
  removeAppUpdateListener = window.updates.onStateChange((state) => {
    appUpdateState.value = state
  })
  appUpdateState.value = await window.updates.getState()
  window.addEventListener('popstate', handleHistoryNavigation)
  window.addEventListener('pagehide', handlePageExit)
  window.addEventListener('beforeunload', handlePageExit)
  window.addEventListener('keydown', handleGlobalKeydown)
  void loadRepositories()
})

watch([selectedPath, hasRunningScripts], syncDesktopMenuState, { immediate: true })

onBeforeUnmount(() => {
  window.removeEventListener('popstate', handleHistoryNavigation)
  window.removeEventListener('pagehide', handlePageExit)
  window.removeEventListener('beforeunload', handlePageExit)
  window.removeEventListener('keydown', handleGlobalKeydown)
  handlePageExit()
  removeScriptOutputListener?.()
  removeGitCommandListener?.()
  removeWindowFocusListener?.()
  removeMenuCommandListener?.()
  removeAppUpdateListener?.()
})
</script>

<template>
  <main class="app-shell">
    <AppHeader
      :active-repository-name="selectedDetails?.name ?? selectedSummary?.name"
      :active-repository-path="selectedDetails?.path ?? selectedSummary?.path"
      :active-script-count="activeTerminals.length"
      :command-shortcut-label="commandShortcutLabel"
      :settings-shortcut-label="settingsShortcutLabel"
      @command-palette="openCommandPalette"
      @settings="isSettingsOpen = true"
    >
      <template v-if="selectedPath" #repository-controls>
        <RepositoryHeaderControls
          :selected-details="selectedDetails"
          :is-detail-loading="isDetailLoading"
          :auto-refresh-label="autoRefreshLabel"
          :auto-refresh-progress="autoRefreshProgress"
          :dashboard-shortcut-label="dashboardShortcutLabel"
          :branch-shortcut-label="branchShortcutLabel"
          :branch-shortcut-trigger-token="branchShortcutTriggerToken"
          :commit-celebrations="appSettings.commitCelebrations"
          :sync-celebration-token="syncCelebrationToken"
          :sync-shortcut-label="syncShortcutLabel"
          :syncing-branch-name="syncingBranchName"
          :syncing-submodule-branch-name="syncingSubmoduleBranchName"
          :deleting-branch-name="deletingBranchName"
          :deleting-submodule-branch-name="deletingSubmoduleBranchName"
          :checking-out-branch-name="checkingOutBranchName"
          :checking-out-submodule-branch-name="checkingOutSubmoduleBranchName"
          :merging-branch-name="mergingBranchName"
          :merging-linked-branch-name="mergingLinkedBranchName"
          :branch-feedback-messages="branchFeedbackMessages"
          :repository-branch-links="repositoryBranchLinks"
          @dashboard="closeDetails"
          @refresh="refreshSelectedRepository"
          @delete-branch="deleteBranch"
          @delete-submodule-branch="deleteSubmoduleBranch"
          @checkout-branch="checkoutBranch"
          @checkout-remote-branch="checkoutRemoteBranch"
          @checkout-submodule-branch="checkoutSubmoduleBranch"
          @sync-branch="syncBranch"
          @sync-submodule-branch="syncSubmoduleBranch"
          @save-repository-branch-link="saveRepositoryBranchLink"
          @remove-repository-branch-link="removeRepositoryBranchLink"
          @merge-branch="mergeBranch"
          @merge-linked-submodule-branch="mergeLinkedSubmoduleBranch"
          @copy-path="copyRepositoryPath"
          @open-in-editor="openRepositoryInEditor"
          @open-in-file-manager="openRepositoryInFileManager"
          @open-in-terminal="openRepositoryInTerminal"
        />
      </template>
    </AppHeader>

    <section v-if="appUpdateBannerVisible" class="app-update-banner" role="status">
      <div class="app-update-copy">
        <span class="state-chip info">Update</span>
        <p>{{ appUpdateBannerMessage }}</p>
      </div>
      <AppButton
        icon="pull"
        :disabled="appUpdateActionDisabled"
        @click="runAppUpdateAction"
      >
        {{ appUpdateActionLabel }}
      </AppButton>
    </section>

    <div class="app-layout">
      <div class="main-pane">
        <RepositoryDashboard
          v-if="!selectedPath"
          v-model:repo-path-input="repoPathInput"
          :repositories="repositories"
          :local-repository-candidates="localRepositoryCandidates"
          :github-repositories="githubRepositories"
          :pinned-repository-paths="pinnedRepositoryPaths"
          :running-scripts-by-repository-path="runningScriptsByRepositoryPath"
          :last-refreshed-label="lastRepositoryRefreshLabel"
          :auto-refresh-label="autoRefreshLabel"
          :auto-refresh-progress="autoRefreshProgress"
          :is-loading="isLoading"
          :is-refreshing="isRefreshingRepositories"
          :is-scanning-local-repositories="isScanningLocalRepositories"
          :has-scanned-local-repositories="hasScannedLocalRepositories"
          :local-repository-scan-error="localRepositoryScanError"
          :is-loading-git-hub-repositories="isLoadingGitHubRepositories"
          :has-loaded-git-hub-repositories="hasLoadedGitHubRepositories"
          :cloning-git-hub-repository-name="cloningGitHubRepositoryName"
          :github-repositories-error="githubRepositoriesError"
          @add="addRepositoryByPath"
          @browse="chooseAndAddRepository"
          @refresh="loadRepositories"
          @scan-local-repositories="scanLocalRepositories"
          @add-scanned-local-repository="addScannedLocalRepository"
          @load-git-hub-repositories="loadGitHubRepositories"
          @clone-git-hub-repository="cloneGitHubRepository"
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
          v-model:active-detail-tab="activeRepositoryDetailTab"
          :selected-details="selectedDetails"
          :selected-summary="selectedSummary"
          :is-detail-loading="isDetailLoading"
          :status-action-label="statusActionLabel"
          :pending-status-action-key="pendingStatusActionKey"
          :commit-clear-token="commitClearToken"
          :commit-celebrations="appSettings.commitCelebrations"
          :commit-shortcut-label="commitShortcutLabel"
          :stage-all-shortcut-label="stageAllShortcutLabel"
          :unstage-all-shortcut-label="unstageAllShortcutLabel"
          :project-tasks="projectTasks"
          :pinned-task-ids="pinnedTaskIdsForSelectedRepo"
          :script-terminals-by-script="currentRepoScriptTerminals"
          @refresh="refreshSelectedRepository"
          @stage-files="stageFiles"
          @unstage-files="unstageFiles"
          @reset-tracked-changes="resetTrackedChanges"
          @commit="commitStatus"
          @commit-draft-change="updateCommitDraft"
          @run-script="runScript"
          @toggle-pin-script="togglePinnedTask"
          @stop-script="stopScript"
          @restart-script="restartScript"
          @open-terminal="openScriptTerminal"
          @open-commit-in-browser="openCommitInBrowser"
        />
      </div>

      <ActiveTerminalsSidebar
        :terminals="activeTerminals"
        :pinned-scripts="pinnedScripts"
        :git-command-log="gitCommandLog"
        @stop="stopTerminal"
        @restart="restartTerminal"
        @open="openTerminal"
        @start-pinned="startPinnedScript"
        @open-repository-scripts="openRepositoryScriptsTab"
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

    <CommandPalette
      v-if="isCommandPaletteOpen"
      :items="commandPaletteItems"
      @close="closeCommandPalette"
      @run="runCommandPaletteItem"
    />

    <KeybindingsSheet
      v-if="isKeybindingsOpen"
      :keybindings="KEYBINDINGS"
      :platform="keybindingPlatform"
      @close="closeKeybindingsSheet"
    />

    <div
      v-if="confirmationDialog"
      class="modal-backdrop confirmation-backdrop"
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
          <AppButton variant="secondary" @click="closeConfirmation(false)">
            Cancel
          </AppButton>
          <AppButton
            :variant="confirmationDialog.danger ? 'danger' : 'primary'"
            @click="closeConfirmation(true)"
          >
            {{ confirmationDialog.confirmLabel }}
          </AppButton>
        </div>
      </section>
    </div>

    <div
      v-if="appToasts.length > 0 || errorMessage"
      class="toast-stack"
      aria-live="polite"
      aria-atomic="false"
    >
      <div
        v-for="toast in appToasts"
        :key="toast.id"
        class="toast-message"
        :class="toast.tone"
        role="status"
        @focusin="holdToast(toast.id)"
        @focusout="releaseToast(toast.id)"
        @mouseenter="holdToast(toast.id)"
        @mouseleave="releaseToast(toast.id)"
      >
        <span class="toast-icon" aria-hidden="true"></span>
        <span>{{ toast.message }}</span>
        <AppButton
          size="icon"
          icon="close"
          class="toast-close"
          :aria-label="`Dismiss notification: ${toast.message}`"
          title="Dismiss"
          @click="dismissToast(toast.id)"
        >
          Dismiss
        </AppButton>
      </div>

      <div v-if="errorMessage" class="toast-message error" role="alert">
        <span class="toast-icon" aria-hidden="true"></span>
        <span>{{ errorMessage }}</span>
        <AppButton
          size="icon"
          icon="close"
          class="toast-close"
          aria-label="Dismiss error"
          title="Dismiss"
          @click="errorMessage = ''"
        >
          Dismiss
        </AppButton>
      </div>
    </div>
  </main>
</template>

<style scoped>
.app-shell {
  --top-bar-gap: 0px;
  --top-bar-height: 72px;
}

:global(:root[data-platform="mac"]) .app-shell {
  --top-bar-height: 92px;
}

:global(:root[data-platform="windows"]) .app-shell {
  --top-bar-height: 104px;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(4, 8, 12, 0.62);
}

.confirmation-backdrop {
  z-index: 90;
}

.app-update-banner {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--border-soft);
  margin: 0 calc(var(--shell-x) * -1);
  padding: 10px var(--shell-x);
  background: color-mix(in srgb, var(--info-soft) 58%, var(--surface));
  color: var(--text);
}

.app-update-copy {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.app-update-copy p {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--muted-strong);
  font-size: var(--font-size-base);
  font-weight: 720;
}

.confirm-dialog {
  display: grid;
  width: min(440px, 100%);
  gap: 14px;
  border: 0;
  border-radius: 8px;
  padding: 18px;
  background: var(--surface);
  color: var(--text);
  box-shadow: none;
}

.confirm-dialog h2 {
  margin: 0;
  font-size: var(--font-size-title);
}

.confirm-dialog p {
  margin-bottom: 0;
  color: var(--muted-strong);
}

.confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}

.toast-stack {
  position: fixed;
  left: 24px;
  bottom: 24px;
  z-index: 40;
  display: grid;
  align-items: end;
  gap: 10px;
  width: min(460px, calc(100vw - 32px));
  pointer-events: none;
}

.toast-message {
  --toast-accent: var(--muted-strong);
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--toast-accent) 24%, var(--border));
  border-radius: 8px;
  padding: 12px 12px 12px 14px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface) 96%, #fff),
      color-mix(in srgb, var(--surface) 86%, var(--surface-soft))
    );
  color: var(--text);
  font-size: var(--font-size-base);
  font-weight: 760;
  line-height: 1.35;
  box-shadow:
    0 18px 40px rgba(7, 13, 19, 0.18),
    0 3px 10px rgba(7, 13, 19, 0.12),
    inset 0 1px 0 color-mix(in srgb, #fff 52%, transparent);
  pointer-events: auto;
}

.toast-message::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 4px;
  background: var(--toast-accent);
  content: "";
}

.toast-message > span:not(.toast-icon) {
  min-width: 0;
  overflow-wrap: anywhere;
}

.toast-message.success {
  --toast-accent: var(--success-text);
}

.toast-message.info {
  --toast-accent: var(--info-text);
}

.toast-message.error {
  --toast-accent: var(--danger-text);
}

.toast-close {
  display: grid;
  width: 30px;
  min-width: 30px;
  height: 30px;
  min-height: 30px;
  flex: 0 0 auto;
  margin-left: auto;
  border-color: transparent;
  place-items: center;
  padding: 0;
  background: color-mix(in srgb, var(--surface-soft) 74%, transparent);
  box-shadow: none;
  color: var(--muted);
  font-size: var(--font-size-compact);
  line-height: 1;
}

.toast-close :deep(.button-icon) {
  width: 16px;
  height: 16px;
  font-size: 16px;
}

.toast-close:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--toast-accent) 42%, transparent);
  background: color-mix(in srgb, var(--toast-accent) 12%, var(--surface));
  color: var(--toast-accent);
}

.toast-icon {
  position: relative;
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--toast-accent) 42%, transparent);
  background: color-mix(in srgb, var(--toast-accent) 14%, var(--surface));
  color: var(--toast-accent);
  opacity: 1;
  place-items: center;
}

.toast-icon::before {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentColor;
  content: "";
}

.toast-message.success .toast-icon::before {
  width: 10px;
  height: 6px;
  border: 0;
  border-bottom: 2px solid currentColor;
  border-left: 2px solid currentColor;
  border-radius: 0;
  background: transparent;
  transform: translateY(-1px) rotate(-45deg);
}

.toast-message.error .toast-icon::before {
  width: auto;
  height: auto;
  border-radius: 0;
  background: transparent;
  content: "!";
  font-size: var(--font-size-base);
  font-weight: 900;
  line-height: 1;
}

@media (max-width: 760px) {
  .app-shell {
    --shell-x: 20px;
    padding: 0 var(--shell-x) 20px;
  }

  .app-layout {
    grid-template-columns: 1fr;
    margin-right: 0;
  }

  .main-pane {
    --main-pane-right-padding: 0px;
    min-height: 0;
  }

  .toast-stack {
    right: 16px;
    bottom: 16px;
    left: 16px;
    width: auto;
  }

  .app-update-banner {
    align-items: stretch;
    flex-direction: column;
  }

  .app-update-banner :deep(.app-button) {
    width: 100%;
  }
}

@media (min-width: 761px) and (max-width: 1180px) {
  .app-layout {
    grid-template-columns: 1fr;
    margin-right: 0;
  }

  .main-pane {
    --main-pane-right-padding: 0px;
    min-height: 0;
  }
}
</style>
