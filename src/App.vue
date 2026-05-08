<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import RepositoryDashboard from './components/RepositoryDashboard.vue'
import RepositoryDetail from './components/RepositoryDetail.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import TerminalModal from './components/TerminalModal.vue'
import { ActiveTerminalsSidebar, CommandPalette, RepositoryHeaderControls } from './components/smart'
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
import type {
  DesktopMenuCommand,
  GitCommandLogEntry,
  PinnedScript,
  RepositorySummary,
} from './repositories'
import type { AppSettings } from './settings'

const MAX_GIT_COMMAND_LOG_ENTRIES = 80

const repositories = ref<RepositorySummary[]>([])
const repoPathInput = ref('')
const isLoading = ref(false)
const isRefreshingRepositories = ref(false)
const lastRepositoryListRefreshAt = ref<Date | null>(null)
const isMacPlatform = ref(false)
const gitCommandLog = ref<GitCommandLogEntry[]>([])
let removeScriptOutputListener: (() => void) | undefined
let removeGitCommandListener: (() => void) | undefined
let removeWindowFocusListener: (() => void) | undefined
let removeMenuCommandListener: (() => void) | undefined

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
  stopAutoRefreshTimer: () => stopAutoRefreshTimer(),
})
const selectedSummary = selectedSummaryFrom(repositories)

const npmScripts = computed(() => Object.entries(selectedDetails.value?.npmScripts ?? {}))
const {
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
  stageAllChanges,
  stageFiles,
  statusActionLabel,
  unstageAllChanges,
  unstageFiles,
  updateCommitDraft,
} = useRepositoryStatusActions({
  clearError,
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
const commandShortcutLabel = computed(() =>
  isMacPlatform.value ? '⌘K' : 'Ctrl K',
)
const commitShortcutLabel = computed(() =>
  isMacPlatform.value ? '⌘↵' : 'Ctrl ↵',
)
const unstageAllShortcutLabel = computed(() =>
  isMacPlatform.value ? '⌘⇧A' : 'Ctrl Shift A',
)
const syncShortcutLabel = computed(() =>
  isMacPlatform.value ? '⌘S' : 'Ctrl S',
)

async function saveAppSettings(settings: AppSettings) {
  try {
    await persistAppSettings(settings)
    showAppFeedback('Settings saved.')

    if (selectedPath.value) {
      resetAutoRefreshTimer()
    }
  } catch (error) {
    showError(error)
  }
}

function showRepositoryError(_repoPath: string, _title: string, error: unknown) {
  showError(error)
}

function activeRepositoryPath() {
  return selectedDetails.value?.path ?? selectedSummary.value?.path
}

async function startPinnedScript(script: PinnedScript) {
  await runRepositoryScript(script)
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
    removePinnedScriptsForRepository(repoPath)

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

async function handleMenuCommand(command: DesktopMenuCommand) {
  if (command === 'settings') {
    isSettingsOpen.value = true
    return
  }

  if (command === 'add-repository') {
    await chooseAndAddRepository()
    return
  }

  if (command === 'back') {
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
    showAppFeedback('Stopped running scripts.', 'info')
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
    key === 's' &&
    !event.altKey &&
    !event.shiftKey
  ) {
    event.preventDefault()

    if (
      canSyncCurrentBranch() &&
      !isCommandPaletteOpen.value &&
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
    openCommandPalette()
    return
  }

  if (event.key === '/' && !isEditableTarget(event.target)) {
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
  isMacPlatform.value = navigator.platform.toLowerCase().includes('mac')
  document.documentElement.dataset.platform = isMacPlatform.value ? 'mac' : 'other'
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
  window.addEventListener('popstate', handleHistoryNavigation)
  window.addEventListener('pagehide', handlePageExit)
  window.addEventListener('beforeunload', handlePageExit)
  window.addEventListener('keydown', handleGlobalKeydown)
  void loadRepositories()
})

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
})
</script>

<template>
  <main class="app-shell">
    <AppHeader
      :active-repository-name="selectedDetails?.name ?? selectedSummary?.name"
      :active-repository-path="selectedDetails?.path ?? selectedSummary?.path"
      :active-script-count="activeTerminals.length"
      :command-shortcut-label="commandShortcutLabel"
      @command-palette="openCommandPalette"
      @settings="isSettingsOpen = true"
    >
      <template v-if="selectedPath" #repository-controls>
        <RepositoryHeaderControls
          :selected-details="selectedDetails"
          :is-detail-loading="isDetailLoading"
          :auto-refresh-label="autoRefreshLabel"
          :auto-refresh-progress="autoRefreshProgress"
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
          @back="closeDetails"
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

    <div class="app-layout">
      <div class="main-pane">
        <RepositoryDashboard
          v-if="!selectedPath"
          v-model:repo-path-input="repoPathInput"
          :repositories="repositories"
          :pinned-repository-paths="pinnedRepositoryPaths"
          :running-scripts-by-repository-path="runningScriptsByRepositoryPath"
          :last-refreshed-label="lastRepositoryRefreshLabel"
          :is-loading="isLoading"
          :is-refreshing="isRefreshingRepositories"
          @add="addRepositoryByPath"
          @browse="chooseAndAddRepository"
          @refresh="loadRepositories"
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
          :status-action-label="statusActionLabel"
          :pending-status-action-key="pendingStatusActionKey"
          :commit-clear-token="commitClearToken"
          :commit-celebrations="appSettings.commitCelebrations"
          :commit-shortcut-label="commitShortcutLabel"
          :unstage-all-shortcut-label="unstageAllShortcutLabel"
          :npm-scripts="npmScripts"
          :pinned-script-names="pinnedScriptNamesForSelectedRepo"
          :script-terminals-by-script="currentRepoScriptTerminals"
          @refresh="refreshSelectedRepository"
          @stage-files="stageFiles"
          @unstage-files="unstageFiles"
          @commit="commitStatus"
          @commit-draft-change="updateCommitDraft"
          @run-script="runScript"
          @toggle-pin-script="togglePinnedScript"
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
