<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ActiveTerminalsSidebar from './components/ActiveTerminalsSidebar.vue'
import AppHeader from './components/AppHeader.vue'
import RepositoryDashboard from './components/RepositoryDashboard.vue'
import RepositoryDetail from './components/RepositoryDetail.vue'
import type { RepositoryDetails, RepositorySummary, ScriptOutput, ScriptTerminal } from './repositories'

const AUTO_REFRESH_INTERVAL_MS = 60 * 1000

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
const autoRefreshRemainingMs = ref(AUTO_REFRESH_INTERVAL_MS)
const scriptTerminals = ref<Record<string, ScriptTerminal>>({})
let removeScriptOutputListener: (() => void) | undefined
let autoRefreshTickTimer: number | undefined
let statusFeedbackTimer: number | undefined
let nextAutoRefreshAt = 0
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
const autoRefreshProgress = computed(() =>
  Math.max(0, Math.min(100, (autoRefreshRemainingMs.value / AUTO_REFRESH_INTERVAL_MS) * 100)),
)
const autoRefreshLabel = computed(() => {
  const totalSeconds = Math.ceil(autoRefreshRemainingMs.value / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')} until auto refresh`
})

function normalizeError(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

async function loadRepositories() {
  isLoading.value = true
  errorMessage.value = ''

  try {
    repositories.value = await window.repositories.list()
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

async function deleteBranch(branchName: string) {
  if (!selectedDetails.value) {
    return
  }

  if (
    !window.confirm(
      `Remove local branch "${branchName}" from ${selectedDetails.value.name}?\n\nThis only deletes the local branch.`,
    )
  ) {
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

  if (
    !window.confirm(
      `Sync branch "${branchName}" in ${selectedDetails.value.name}?\n\nThis will fetch/pull and fast-forward the local branch when possible.`,
    )
  ) {
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

  if (
    !window.confirm(
      `Remove "${repositoryName}" from Web Dev Companion?\n\nThe repository folder will stay on disk.`,
    )
  ) {
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
  } catch (error) {
    errorMessage.value = normalizeError(error)
  } finally {
    isLoading.value = false
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
  nextAutoRefreshAt = Date.now() + AUTO_REFRESH_INTERVAL_MS
  autoRefreshRemainingMs.value = AUTO_REFRESH_INTERVAL_MS

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
  autoRefreshRemainingMs.value = AUTO_REFRESH_INTERVAL_MS
}

function updateCommitDraft(hasDraft: boolean) {
  hasCommitDraft.value = hasDraft
}

async function runScript(scriptName: string) {
  if (!selectedDetails.value || currentRepoScriptTerminals.value[scriptName]) {
    return
  }

  errorMessage.value = ''

  try {
    const scriptRun = await window.repositories.startScript({
      repoPath: selectedDetails.value.path,
      scriptName,
      packageManager: selectedDetails.value.packageManager,
    })

    appOwnedRunIds.add(scriptRun.runId)
    scriptTerminals.value = {
      ...scriptTerminals.value,
      [scriptRun.runId]: {
        runId: scriptRun.runId,
        repoPath: selectedDetails.value.path,
        repoName: selectedDetails.value.name,
        scriptName,
        command: scriptRun.command,
        output: `$ ${scriptRun.command}\n`,
        isRunning: true,
      },
    }
  } catch (error) {
    errorMessage.value = normalizeError(error)
  }
}

async function stopScript(scriptName: string) {
  const terminal = currentRepoScriptTerminals.value[scriptName]

  if (!terminal) {
    return
  }

  await stopTerminal(terminal.runId)
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
}

function handlePageExit() {
  if (statusFeedbackTimer !== undefined) {
    window.clearTimeout(statusFeedbackTimer)
    statusFeedbackTimer = undefined
  }

  stopAutoRefreshTimer()
  stopOwnedScripts()
}

onMounted(() => {
  removeScriptOutputListener = window.repositories.onScriptOutput(handleScriptOutput)
  window.addEventListener('pagehide', handlePageExit)
  window.addEventListener('beforeunload', handlePageExit)
  void loadRepositories()
})

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', handlePageExit)
  window.removeEventListener('beforeunload', handlePageExit)
  handlePageExit()
  removeScriptOutputListener?.()
})
</script>

<template>
  <main class="app-shell">
    <AppHeader :repository-count="repositories.length" />

    <p v-if="errorMessage" class="alert" role="alert">{{ errorMessage }}</p>

    <div class="app-layout" :class="{ 'terminals-collapsed': areTerminalsCollapsed }">
      <div class="main-pane">
        <RepositoryDashboard
          v-if="!selectedPath"
          v-model:repo-path-input="repoPathInput"
          :repositories="repositories"
          :is-loading="isLoading"
          @add="addRepositoryByPath"
          @browse="chooseAndAddRepository"
          @open="openRepository"
          @remove="removeRepository"
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
        />
      </div>

      <ActiveTerminalsSidebar
        :terminals="activeTerminals"
        :collapsed="areTerminalsCollapsed"
        @toggle="areTerminalsCollapsed = !areTerminalsCollapsed"
        @stop="stopTerminal"
      />
    </div>
  </main>
</template>
