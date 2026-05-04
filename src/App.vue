<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppHeader from './components/AppHeader.vue'
import RepositoryDashboard from './components/RepositoryDashboard.vue'
import RepositoryDetail from './components/RepositoryDetail.vue'
import type { RepositoryDetails, RepositorySummary, ScriptOutput, ScriptTerminal } from './repositories'

const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000

const repositories = ref<RepositorySummary[]>([])
const selectedPath = ref<string | null>(null)
const selectedDetails = ref<RepositoryDetails | null>(null)
const repoPathInput = ref('')
const errorMessage = ref('')
const isLoading = ref(false)
const isDetailLoading = ref(false)
const autoRefreshRemainingMs = ref(AUTO_REFRESH_INTERVAL_MS)
const scriptTerminals = ref<Record<string, ScriptTerminal>>({})
let removeScriptOutputListener: (() => void) | undefined
let autoRefreshTickTimer: number | undefined
let nextAutoRefreshAt = 0
const pageOwnedRunIds = new Set<string>()

const selectedSummary = computed(() =>
  repositories.value.find((repository) => repository.path === selectedPath.value),
)

const npmScripts = computed(() => Object.entries(selectedDetails.value?.npmScripts ?? {}))
const hasRunningScripts = computed(() =>
  Object.values(scriptTerminals.value).some((terminal) => terminal.isRunning),
)
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
  stopVisibleScripts()

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

async function removeRepository(repoPath: string) {
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
  stopVisibleScripts()
}

function stopVisibleScripts() {
  if (pageOwnedRunIds.size > 0) {
    window.repositories.stopScripts([...pageOwnedRunIds])
  }

  pageOwnedRunIds.clear()
  scriptTerminals.value = {}
}

function handleScriptOutput(output: ScriptOutput) {
  const scriptName = Object.keys(scriptTerminals.value).find(
    (name) => scriptTerminals.value[name].runId === output.runId,
  )

  if (!scriptName) {
    return
  }

  const terminal = scriptTerminals.value[scriptName]

  scriptTerminals.value[scriptName] = {
    ...terminal,
    output: `${terminal.output}${output.text}`,
    isRunning: output.done ? false : terminal.isRunning,
  }

  if (output.done) {
    pageOwnedRunIds.delete(output.runId)
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

  if (hasRunningScripts.value) {
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

async function runScript(scriptName: string) {
  if (!selectedDetails.value || scriptTerminals.value[scriptName]?.isRunning) {
    return
  }

  errorMessage.value = ''

  try {
    const scriptRun = await window.repositories.startScript({
      repoPath: selectedDetails.value.path,
      scriptName,
      packageManager: selectedDetails.value.packageManager,
    })

    pageOwnedRunIds.add(scriptRun.runId)
    scriptTerminals.value = {
      ...scriptTerminals.value,
      [scriptName]: {
        runId: scriptRun.runId,
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
  const terminal = scriptTerminals.value[scriptName]

  if (!terminal) {
    return
  }

  if (terminal.isRunning) {
    await window.repositories.stopScript(terminal.runId)
  }

  pageOwnedRunIds.delete(terminal.runId)
  const nextTerminals = { ...scriptTerminals.value }
  delete nextTerminals[scriptName]
  scriptTerminals.value = nextTerminals
}

function handlePageExit() {
  stopAutoRefreshTimer()
  stopVisibleScripts()
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
      :npm-scripts="npmScripts"
      :script-terminals="scriptTerminals"
      @back="closeDetails"
      @refresh="refreshSelectedRepository"
      @run-script="runScript"
      @stop-script="stopScript"
    />
  </main>
</template>
