<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import type { RepositoryDetails, RepositorySummary, ScriptOutput } from './repositories'

interface ScriptTerminal {
  runId: string
  command: string
  output: string
  isRunning: boolean
}

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
const terminalOutputElements = ref<Record<string, HTMLPreElement>>({})
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
  terminalOutputElements.value = {}
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

  scrollTerminalToBottom(scriptName)
}

function setTerminalOutputElement(scriptName: string, element: Element | ComponentPublicInstance | null) {
  if (element instanceof HTMLPreElement) {
    terminalOutputElements.value[scriptName] = element
    scrollTerminalToBottom(scriptName)
    return
  }

  delete terminalOutputElements.value[scriptName]
}

function scrollTerminalToBottom(scriptName: string) {
  void nextTick(() => {
    const terminalOutputElement = terminalOutputElements.value[scriptName]

    if (!terminalOutputElement) {
      return
    }

    terminalOutputElement.scrollTop = terminalOutputElement.scrollHeight
  })
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
    scrollTerminalToBottom(scriptName)
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
  delete terminalOutputElements.value[scriptName]
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
    <header class="top-bar">
      <div>
        <p class="eyebrow">Web Dev Companion</p>
        <h1>Repositories</h1>
      </div>

      <div class="repo-count">
        <span>{{ repositories.length }}</span>
        <small>saved</small>
      </div>
    </header>

    <p v-if="errorMessage" class="alert" role="alert">{{ errorMessage }}</p>

    <section v-if="!selectedPath" class="dashboard">
      <form class="add-repo" @submit.prevent="addRepositoryByPath">
        <label for="repo-path">Repository path</label>
        <div class="add-row">
          <input
            id="repo-path"
            v-model="repoPathInput"
            type="text"
            placeholder="/Users/alexanderclaes/project"
            autocomplete="off"
          />
          <button type="submit" :disabled="isLoading">Add</button>
          <button type="button" class="secondary" :disabled="isLoading" @click="chooseAndAddRepository">
            Browse
          </button>
        </div>
      </form>

      <div v-if="isLoading && repositories.length === 0" class="empty-state">
        Loading repositories...
      </div>

      <div v-else-if="repositories.length === 0" class="empty-state">
        No repositories saved.
      </div>

      <div v-else class="repo-grid">
        <article
          v-for="repository in repositories"
          :key="repository.path"
          class="repo-card"
          :class="{ 'has-error': repository.error }"
        >
          <button class="repo-card-main" type="button" @click="openRepository(repository)">
            <span class="repo-title-row">
              <strong>{{ repository.name }}</strong>
              <span class="status-pill" :class="{ dirty: repository.dirty }">
                {{ repository.dirty ? 'Changes' : 'Clean' }}
              </span>
            </span>
            <span class="repo-path">{{ repository.path }}</span>
            <span class="repo-meta">
              <span>{{ repository.branch }}</span>
              <span>{{ repository.npmScriptCount }} scripts</span>
            </span>
            <span class="last-commit">{{ repository.error ?? repository.lastCommit }}</span>
          </button>

          <button
            class="icon-button"
            type="button"
            :aria-label="`Remove ${repository.name}`"
            title="Remove"
            @click="removeRepository(repository.path)"
          >
            x
          </button>
        </article>
      </div>
    </section>

    <section v-else class="detail-view">
      <nav class="detail-nav" aria-label="Repository detail navigation">
        <button type="button" class="secondary" @click="closeDetails">Back</button>
        <button
          type="button"
          class="secondary refresh-button"
          :disabled="isDetailLoading"
          :title="autoRefreshLabel"
          @click="refreshSelectedRepository"
        >
          <span class="refresh-button-label">Refresh</span>
          <span class="refresh-progress" aria-hidden="true">
            <span class="refresh-progress-fill" :style="{ width: `${autoRefreshProgress}%` }"></span>
          </span>
        </button>
      </nav>

      <div v-if="isDetailLoading && !selectedDetails" class="empty-state">
        Loading repository...
      </div>

      <template v-else-if="selectedDetails">
        <header class="detail-header">
          <div>
            <p class="repo-path">{{ selectedDetails.path }}</p>
            <h2>{{ selectedDetails.name }}</h2>
          </div>
          <span class="status-pill" :class="{ dirty: selectedDetails.dirty }">
            {{ selectedDetails.dirty ? 'Changes' : 'Clean' }}
          </span>
        </header>

        <div class="summary-strip">
          <div>
            <span>Branch</span>
            <strong>{{ selectedDetails.branch }}</strong>
          </div>
          <div>
            <span>Latest</span>
            <strong>{{ selectedDetails.lastCommit }}</strong>
          </div>
          <div>
            <span>Package</span>
            <strong>{{ selectedDetails.packageManager ?? 'none' }}</strong>
          </div>
        </div>

        <div class="detail-layout">
          <section class="detail-panel">
            <div class="panel-heading">
              <h3>Git log</h3>
            </div>
            <pre>{{ selectedDetails.gitLog }}</pre>
          </section>

          <section class="detail-panel">
            <div class="panel-heading">
              <h3>Status</h3>
            </div>
            <pre>{{ selectedDetails.gitStatus }}</pre>
          </section>

          <section class="detail-panel scripts-panel">
            <div class="panel-heading">
              <h3>NPM scripts</h3>
            </div>
            <div v-if="npmScripts.length" class="script-list">
              <div v-for="[scriptName, command] in npmScripts" :key="scriptName" class="script-item">
                <div v-if="scriptTerminals[scriptName]" class="script-terminal">
                  <div class="terminal-toolbar">
                    <code>{{ scriptTerminals[scriptName].command }}</code>
                    <button type="button" class="terminal-stop" @click="stopScript(scriptName)">
                      Stop
                    </button>
                  </div>
                  <pre :ref="(element) => setTerminalOutputElement(scriptName, element)">{{ scriptTerminals[scriptName].output }}</pre>
                </div>

                <button v-else class="script-row" type="button" @click="runScript(scriptName)">
                  <code>{{ scriptName }}</code>
                  <span>{{ command }}</span>
                </button>
              </div>
            </div>
            <p v-else class="muted">No scripts found.</p>
          </section>

          <section class="detail-panel">
            <div class="panel-heading">
              <h3>Remotes</h3>
            </div>
            <pre>{{ selectedDetails.remotes }}</pre>
          </section>
        </div>
      </template>

      <div v-else class="empty-state">
        {{ selectedSummary?.name ?? 'Repository' }} could not be loaded.
      </div>
    </section>
  </main>
</template>
