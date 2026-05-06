<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ActiveTerminalsSidebar from './components/ActiveTerminalsSidebar.vue'
import AppHeader from './components/AppHeader.vue'
import CommandPalette from './components/CommandPalette.vue'
import RepositoryDashboard from './components/RepositoryDashboard.vue'
import RepositoryDetail from './components/RepositoryDetail.vue'
import RepositoryHeaderControls from './components/RepositoryHeaderControls.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import TerminalModal from './components/TerminalModal.vue'
import type { CommandPaletteItem } from './command-palette'
import { useConfirmations } from './composables/useConfirmations'
import { useSettings } from './composables/useSettings'
import { useTerminals } from './composables/useTerminals'
import { useToasts } from './composables/useToasts'
import type {
  DesktopMenuCommand,
  PinnedScript,
  RepositoryDetails,
  RepositorySummary,
} from './repositories'
import type { AppSettings } from './settings'

const FOCUS_REFRESH_THROTTLE_MS = 2000
const PINNED_REPOSITORIES_KEY = 'web-dev-companion:pinned-repositories'
const PINNED_SCRIPTS_KEY = 'web-dev-companion:pinned-scripts'
const RECENT_COMMANDS_KEY = 'web-dev-companion:recent-commands'
const MAX_RECENT_COMMANDS = 6
const FEEDBACK_DISMISS_MS = 4000
const AUTO_REFRESH_TICK_MS = 1000
const SCRIPT_ITEM_SEPARATOR = '\n'

type ScriptPaletteReference = {
  repoPath: string
  scriptName: string
}

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
const checkingOutBranchName = ref<string | null>(null)
const statusActionLabel = ref<string | null>(null)
const pendingStatusActionKey = ref<string | null>(null)
const statusFeedbackMessage = ref<string | null>(null)
const branchFeedbackMessages = ref<Record<string, string>>({})
const commitClearToken = ref(0)
const hasCommitDraft = ref(false)
const pinnedRepositoryPaths = ref<string[]>([])
const pinnedScripts = ref<PinnedScript[]>([])
const lastRepositoryListRefreshAt = ref<Date | null>(null)
const isCommandPaletteOpen = ref(false)
const isMacPlatform = ref(false)
const recentCommandIds = ref<string[]>([])
let removeScriptOutputListener: (() => void) | undefined
let removeWindowFocusListener: (() => void) | undefined
let removeMenuCommandListener: (() => void) | undefined
let autoRefreshTickTimer: number | undefined
let statusFeedbackTimer: number | undefined
let nextAutoRefreshAt = 0
let lastFocusRefreshAt = 0

const {
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

  if (checkingOutBranchName.value) {
    return `Switching to ${checkingOutBranchName.value}...`
  }

  if (isDetailLoading.value) {
    return 'Refreshing repository...'
  }

  if (isLoading.value) {
    return 'Refreshing repositories...'
  }

  return null
})
const commandShortcutLabel = computed(() =>
  isMacPlatform.value ? '⌘K' : 'Ctrl K',
)
const commandPaletteItems = computed(() => {
  const items = new Map<string, CommandPaletteItem>()
  const addItem = (item: CommandPaletteItem) => {
    items.set(item.id, item)
  }
  const currentRepoPath = activeRepositoryPath()

  addItem({
    id: 'action:add-repository',
    icon: 'folder',
    title: 'Add repository',
    section: 'App',
    subtitle: 'Choose a repository folder to save',
    keywords: ['browse', 'folder', 'new'],
  })
  addItem({
    id: 'action:refresh',
    icon: 'restart',
    title: selectedPath.value ? 'Refresh repository' : 'Refresh repositories',
    section: 'App',
    subtitle: selectedPath.value ? 'Reload current repository details' : 'Reload saved repositories',
    keywords: ['reload', 'sync'],
  })
  addItem({
    id: 'action:settings',
    icon: 'command',
    title: 'Open settings',
    section: 'App',
    meta: isMacPlatform.value ? '⌘,' : 'Ctrl ,',
    keywords: ['preferences'],
  })

  if (selectedPath.value) {
    addItem({
      id: 'action:back',
      icon: 'arrow-left',
      title: 'Back to repositories',
      section: 'Navigation',
      meta: 'Esc',
      keywords: ['dashboard', 'home'],
    })
  }

  if (currentRepoPath) {
    addItem({
      id: 'action:open-files',
      icon: 'folder',
      title: 'Open repository files',
      section: 'Repository',
      subtitle: currentRepoPath,
      keywords: ['finder', 'explorer', 'folder'],
    })
    addItem({
      id: 'action:open-editor',
      icon: 'edit',
      title: 'Open repository in editor',
      section: 'Repository',
      subtitle: currentRepoPath,
      keywords: ['code', 'ide'],
    })
    addItem({
      id: 'action:open-terminal',
      icon: 'terminal',
      title: 'Open repository terminal',
      section: 'Repository',
      subtitle: currentRepoPath,
      keywords: ['shell', 'console'],
    })
    addItem({
      id: 'action:copy-path',
      icon: 'copy',
      title: 'Copy repository path',
      section: 'Repository',
      subtitle: currentRepoPath,
      keywords: ['clipboard'],
    })
  }

  if (hasRunningScripts.value) {
    addItem({
      id: 'action:stop-scripts',
      icon: 'terminal',
      title: 'Stop running scripts',
      section: 'Scripts',
      subtitle: `${activeTerminals.value.filter((terminal) => terminal.isRunning).length} running`,
      keywords: ['cancel', 'abort'],
    })
  }

  for (const repository of repositories.value) {
    addItem({
      id: `repository:${repository.path}`,
      icon: 'repository',
      title: repository.name,
      section: 'Repositories',
      subtitle: repository.path,
      meta: repository.dirty ? 'Changes' : repository.branch,
      keywords: [repository.branch, repository.lastCommit, repository.remote ?? ''],
    })
  }

  if (selectedDetails.value) {
    for (const [scriptName, command] of Object.entries(selectedDetails.value.npmScripts)) {
      addItem({
        id: `script:${paletteScriptId(selectedDetails.value.path, scriptName)}`,
        icon: 'play',
        title: `Run ${scriptName}`,
        section: 'Current scripts',
        subtitle: command,
        meta: selectedDetails.value.packageManager ?? 'npm',
        keywords: [selectedDetails.value.name, selectedDetails.value.path],
      })
    }
  }

  for (const script of pinnedScripts.value) {
    addItem({
      id: `script:${paletteScriptId(script.repoPath, script.scriptName)}`,
      icon: 'play',
      title: `Run ${script.scriptName}`,
      section: 'Pinned scripts',
      subtitle: `${script.repoName} · ${script.command}`,
      meta: script.packageManager ?? 'npm',
      keywords: [script.repoName, script.repoPath],
    })
  }

  for (const terminal of activeTerminals.value) {
    addItem({
      id: `terminal:${terminal.runId}`,
      icon: 'terminal',
      title: `Open ${terminal.scriptName}`,
      section: 'Terminals',
      subtitle: terminal.repoName,
      meta: terminal.isRunning ? 'Running' : 'Finished',
      keywords: [terminal.command, terminal.repoPath],
    })
  }

  const baseItems = [...items.values()]
  const recentItems = recentCommandIds.value
    .map((commandId) => items.get(commandId))
    .filter((item): item is CommandPaletteItem => Boolean(item))
    .map((item) => ({
      ...item,
      id: `recent:${item.id}`,
      actionId: item.actionId ?? item.id,
      section: 'Recent',
      keywords: [...(item.keywords ?? []), 'recent'],
    }))

  return [...recentItems, ...baseItems]
})

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry): entry is string => typeof entry === 'string')
}

function isPinnedScript(script: unknown): script is PinnedScript {
  return (
    typeof script === 'object' &&
    script !== null &&
    typeof (script as Pick<PinnedScript, 'repoPath'>).repoPath === 'string' &&
    typeof (script as Pick<PinnedScript, 'repoName'>).repoName === 'string' &&
    typeof (script as Pick<PinnedScript, 'scriptName'>).scriptName === 'string' &&
    typeof (script as Pick<PinnedScript, 'command'>).command === 'string' &&
    ((script as Pick<PinnedScript, 'packageManager'>).packageManager === undefined ||
      typeof (script as Pick<PinnedScript, 'packageManager'>).packageManager === 'string')
  )
}

function isPinnedScriptList(value: unknown): value is PinnedScript[] {
  return Array.isArray(value) && value.every(isPinnedScript)
}

function readStoredValue<T>(key: string, validator: (value: unknown) => value is T, fallback: T) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (validator(parsed)) {
      return parsed
    }
  } catch {}

  return fallback
}

function writeStoredValue<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

function paletteScriptId(repoPath: string, scriptName: string) {
  return `${repoPath}${SCRIPT_ITEM_SEPARATOR}${scriptName}`
}

function parsePaletteScriptId(value: string): ScriptPaletteReference | null {
  const separatorIndex = value.lastIndexOf(SCRIPT_ITEM_SEPARATOR)
  if (separatorIndex < 0) {
    return null
  }

  return {
    repoPath: value.slice(0, separatorIndex),
    scriptName: value.slice(separatorIndex + 1),
  }
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
  stopAutoRefreshTimer()
  selectedPath.value = null
  selectedDetails.value = null
  hasCommitDraft.value = false
}

async function applyHistoryState(state: AppHistoryState | undefined) {
  if (!state || state.view === 'dashboard') {
    showDashboard()
    return
  }

  selectedPath.value = state.repoPath
  await loadRepositoryDetails(state.repoPath)
}

function loadPinnedRepositories() {
  pinnedRepositoryPaths.value = readStoredValue(PINNED_REPOSITORIES_KEY, isStringArray, [])
}

function loadPinnedScripts() {
  pinnedScripts.value = readStoredValue(PINNED_SCRIPTS_KEY, isPinnedScriptList, [])
}

function loadRecentCommands() {
  recentCommandIds.value = readStoredValue(RECENT_COMMANDS_KEY, isStringArray, [])
}

function savePinnedRepositories(repoPaths: string[]) {
  pinnedRepositoryPaths.value = repoPaths
  writeStoredValue(PINNED_REPOSITORIES_KEY, repoPaths)
}

function savePinnedScripts(scripts: PinnedScript[]) {
  pinnedScripts.value = scripts
  writeStoredValue(PINNED_SCRIPTS_KEY, scripts)
}

function saveRecentCommands(commandIds: string[]) {
  recentCommandIds.value = commandIds.slice(0, MAX_RECENT_COMMANDS)
  writeStoredValue(RECENT_COMMANDS_KEY, recentCommandIds.value)
}

function rememberCommand(commandId: string) {
  saveRecentCommands([
    commandId,
    ...recentCommandIds.value.filter((recentCommandId) => recentCommandId !== commandId),
  ])
}

function pinnedScriptKey(script: Pick<PinnedScript, 'repoPath' | 'scriptName'>) {
  return `${script.repoPath}${SCRIPT_ITEM_SEPARATOR}${script.scriptName}`
}

function saveAppSettings(settings: AppSettings) {
  persistAppSettings(settings)
  showAppFeedback('Settings saved.')

  if (selectedPath.value) {
    resetAutoRefreshTimer()
  }
}

function showRepositoryError(_repoPath: string, _title: string, error: unknown) {
  showError(error)
}

function activeRepositoryPath() {
  return selectedDetails.value?.path ?? selectedSummary.value?.path
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
    showRepositoryError(selectedDetails.value.path, `Could not remove branch "${branchName}"`, error)
  } finally {
    deletingBranchName.value = null
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
  const repoPath = selectedDetails.value.path

  try {
    selectedDetails.value = await window.repositories.syncBranch({
      repoPath,
      branchName,
    })
    await loadRepositories()
    showBranchFeedback(branchName, action.successLabel)
    showAppFeedback(`${action.toastVerb} branch ${branchName}.`)
  } catch (error) {
    showRepositoryError(repoPath, `Could not ${action.confirmLabel.toLowerCase()}`, error)
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
  }, FEEDBACK_DISMISS_MS)
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
  const repoPath = selectedDetails.value.path

  try {
    selectedDetails.value = await action()
    await loadRepositories()
    showStatusFeedback(successMessage)
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

function openCommandPalette() {
  isCommandPaletteOpen.value = true
}

function closeCommandPalette() {
  isCommandPaletteOpen.value = false
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

async function runCommandPaletteItem(itemId: string) {
  rememberCommand(itemId)
  closeCommandPalette()

  if (itemId === 'action:add-repository') {
    await chooseAndAddRepository()
    return
  }

  if (itemId === 'action:refresh') {
    if (selectedPath.value) {
      await refreshSelectedRepository()
      return
    }

    await loadRepositories()
    return
  }

  if (itemId === 'action:settings') {
    isSettingsOpen.value = true
    return
  }

  if (itemId === 'action:back') {
    closeDetails()
    return
  }

  if (itemId === 'action:stop-scripts') {
    stopOwnedScripts()
    showAppFeedback('Stopped running scripts.', 'info')
    return
  }

  const repoPath = activeRepositoryPath()

  if (itemId === 'action:open-files' && repoPath) {
    await openRepositoryInFileManager(repoPath)
    return
  }

  if (itemId === 'action:open-editor' && repoPath) {
    await openRepositoryInEditor(repoPath)
    return
  }

  if (itemId === 'action:open-terminal' && repoPath) {
    await openRepositoryInTerminal(repoPath)
    return
  }

  if (itemId === 'action:copy-path' && repoPath) {
    await copyRepositoryPath(repoPath)
    return
  }

  if (itemId.startsWith('repository:')) {
    const selectedRepositoryPath = itemId.slice('repository:'.length)
    const repository = repositories.value.find((entry) => entry.path === selectedRepositoryPath)

    if (repository) {
      await openRepository(repository)
    }

    return
  }

  if (itemId.startsWith('script:')) {
    const script = parsePaletteScriptId(itemId.slice('script:'.length))

    if (!script) {
      return
    }

    const { repoPath: scriptRepoPath, scriptName } = script

    if (selectedDetails.value?.path === scriptRepoPath) {
      await runScript(scriptName)
      return
    }

    const pinnedScript = pinnedScripts.value.find((script) =>
      script.repoPath === scriptRepoPath && script.scriptName === scriptName,
    )

    if (pinnedScript) {
      await runRepositoryScript(pinnedScript)
    }

    return
  }

  if (itemId.startsWith('terminal:')) {
    openTerminal(itemId.slice('terminal:'.length))
  }
}

async function copyRepositoryPath(repoPath: string) {
  try {
    await navigator.clipboard.writeText(repoPath)
    showAppFeedback('Copied repository path.', 'info')
  } catch {
    showRepositoryError(repoPath, 'Could not copy repository path', new Error('Could not copy repository path.'))
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
    autoRefreshTickTimer = window.setInterval(updateAutoRefreshCountdown, AUTO_REFRESH_TICK_MS)
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

function handleGlobalKeydown(event: KeyboardEvent) {
  const key = event.key.toLowerCase()

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
    closeCommandPalette()
    return
  }

  if (selectedTerminal.value) {
    event.preventDefault()
    closeTerminalModal()
    return
  }

  if (confirmationDialog.value) {
    event.preventDefault()
    closeConfirmation(false)
    return
  }

  if (isSettingsOpen.value) {
    event.preventDefault()
    isSettingsOpen.value = false
    return
  }

}

onMounted(() => {
  isMacPlatform.value = navigator.platform.toLowerCase().includes('mac')
  document.documentElement.dataset.platform = isMacPlatform.value ? 'mac' : 'other'
  replaceHistoryState({ view: 'dashboard' })
  loadAppSettings()
  autoRefreshRemainingMs.value = appSettings.value.autoRefreshIntervalMs
  loadPinnedRepositories()
  loadPinnedScripts()
  loadRecentCommands()
  removeScriptOutputListener = window.repositories.onScriptOutput(handleScriptOutput)
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
  removeWindowFocusListener?.()
  removeMenuCommandListener?.()
})
</script>

<template>
  <main class="app-shell">
    <AppHeader
      :active-repository-name="selectedDetails?.name ?? selectedSummary?.name"
      :active-repository-path="selectedDetails?.path ?? selectedSummary?.path"
      :activity-label="appActivityLabel"
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
          :syncing-branch-name="syncingBranchName"
          :deleting-branch-name="deletingBranchName"
          :checking-out-branch-name="checkingOutBranchName"
          :branch-feedback-messages="branchFeedbackMessages"
          @back="closeDetails"
          @refresh="refreshSelectedRepository"
          @delete-branch="deleteBranch"
          @checkout-branch="checkoutBranch"
          @checkout-remote-branch="checkoutRemoteBranch"
          @sync-branch="syncBranch"
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
          :status-action-label="statusActionLabel"
          :pending-status-action-key="pendingStatusActionKey"
          :status-feedback-message="statusFeedbackMessage"
          :commit-clear-token="commitClearToken"
          :commit-celebrations="appSettings.commitCelebrations"
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
        />
      </div>

      <ActiveTerminalsSidebar
        :terminals="activeTerminals"
        :pinned-scripts="pinnedScripts"
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
