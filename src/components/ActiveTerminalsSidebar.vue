<script setup lang="ts">
import { computed } from 'vue'
import { plainTerminalText } from '../output-formatting'
import type { PinnedScript, ScriptTerminal } from '../repositories'
import { AppButton } from './ui'

interface TerminalGroup {
  repoName: string
  runningCount: number
  doneCount: number
  pinnedCount: number
  entries: TerminalEntry[]
}

interface TerminalEntry {
  key: string
  repoName: string
  scriptName: string
  command: string
  pinnedScript?: PinnedScript
  terminal?: ScriptTerminal
}

type TerminalEntryMap = Map<string, TerminalEntry>
type TerminalGroupMap = Map<string, TerminalEntry[]>

const props = defineProps<{
  terminals: ScriptTerminal[]
  pinnedScripts: PinnedScript[]
}>()

defineEmits<{
  stop: [runId: string]
  restart: [runId: string]
  open: [runId: string]
  startPinned: [script: PinnedScript]
  unpinPinned: [script: PinnedScript]
}>()

const terminalEntriesByKey = computed<TerminalEntryMap>(() => {
  const entriesByKey = new Map<string, TerminalEntry>()

  for (const terminal of props.terminals) {
    const key = getTerminalKey(terminal.repoPath, terminal.scriptName)
    entriesByKey.set(key, {
      key,
      repoName: terminal.repoName,
      scriptName: terminal.scriptName,
      command: terminal.command,
      terminal,
    })
  }

  for (const pinnedScript of props.pinnedScripts) {
    const key = getTerminalKey(pinnedScript.repoPath, pinnedScript.scriptName)
    const existingEntry = entriesByKey.get(key)

    entriesByKey.set(key, {
      key,
      repoName: pinnedScript.repoName,
      scriptName: pinnedScript.scriptName,
      command: existingEntry?.command ?? pinnedScript.command,
      terminal: existingEntry?.terminal,
      pinnedScript,
    })
  }

  return entriesByKey
})

const terminalGroups = computed<TerminalGroup[]>(() => {
  const groups: TerminalGroupMap = new Map<string, TerminalEntry[]>()

  for (const entry of terminalEntriesByKey.value.values()) {
    const existingEntries = groups.get(entry.repoName) ?? []
    existingEntries.push(entry)
    groups.set(entry.repoName, existingEntries)
  }

  return [...groups.entries()]
    .sort(sortEntriesByRepoName)
    .map(([repoName, entries]) => createGroup(repoName, entries))
})

const pinnedIdleCount = computed(() => {
  const activeScriptKeys = new Set(
    props.terminals.map((terminal) => getTerminalKey(terminal.repoPath, terminal.scriptName)),
  )

  let count = 0
  for (const pinnedScript of props.pinnedScripts) {
    if (!activeScriptKeys.has(getTerminalKey(pinnedScript.repoPath, pinnedScript.scriptName))) {
      count += 1
    }
  }
  return count
})

const sidebarScriptCount = computed(() => props.terminals.length + pinnedIdleCount.value)

function createGroup(repoName: string, entries: TerminalEntry[]) {
  const sortedEntries = [...entries].sort(compareTerminalEntries)

  return {
    repoName,
    runningCount: entries.filter((entry) => entry.terminal?.isRunning).length,
    doneCount: entries.filter((entry) => entry.terminal && !entry.terminal.isRunning).length,
    pinnedCount: entries.filter((entry) => entry.pinnedScript).length,
    entries: sortedEntries,
  }
}

function getTerminalKey(repoPath: string, scriptName: string) {
  return `${repoPath}\n${scriptName}`
}

function sortEntriesByRepoName(
  [repoNameA]: [string, TerminalEntry[]],
  [repoNameB]: [string, TerminalEntry[]],
) {
  return repoNameA.localeCompare(repoNameB)
}

function compareTerminalEntries(entryA: TerminalEntry, entryB: TerminalEntry) {
  return (
    Number(Boolean(entryB.terminal?.isRunning)) - Number(Boolean(entryA.terminal?.isRunning))
    || Number(Boolean(entryB.terminal)) - Number(Boolean(entryA.terminal))
    || entryA.scriptName.localeCompare(entryB.scriptName)
  )
}

function getTerminalPreview(terminal: ScriptTerminal) {
  const outputLines = plainTerminalText(terminal.output).split(/\r?\n/)

  for (let i = outputLines.length - 1; i >= 0; i -= 1) {
    const line = outputLines[i].trim()
    if (line) {
      return line
    }
  }

  if (terminal.isRunning) {
    return 'Waiting for output...'
  }

  return 'No output captured.'
}
</script>

<template>
  <aside class="active-terminals" aria-label="Active terminal scripts">
    <div class="active-terminals-heading">
      <div class="active-terminals-title">
        <h2>Scripts</h2>
        <span>{{ sidebarScriptCount }}</span>
      </div>
    </div>

    <div v-if="terminalGroups.length" class="active-terminal-groups">
      <section v-for="group in terminalGroups" :key="group.repoName" class="active-terminal-group">
        <div class="active-terminal-group-heading">
          <h3>{{ group.repoName }}</h3>
          <span>
            {{ group.runningCount }} running
            <template v-if="group.doneCount"> &middot; {{ group.doneCount }} done</template>
            <template v-if="group.pinnedCount"> &middot; {{ group.pinnedCount }} pinned</template>
          </span>
        </div>
        <div class="active-terminal-list">
          <article
            v-for="entry in group.entries"
            :key="entry.key"
            class="active-terminal-item"
            :class="{ pinned: entry.pinnedScript && !entry.terminal }"
            :role="entry.terminal ? 'button' : undefined"
            :tabindex="entry.terminal ? 0 : undefined"
            :title="entry.terminal ? 'Open full terminal' : 'Pinned script'"
            @click="entry.terminal && $emit('open', entry.terminal.runId)"
            @keydown.enter="entry.terminal && $emit('open', entry.terminal.runId)"
            @keydown.space.prevent="entry.terminal && $emit('open', entry.terminal.runId)"
          >
            <div class="active-terminal-main">
              <div class="active-terminal-item-heading">
                <strong>{{ entry.scriptName }}</strong>
                <span
                  class="active-terminal-status"
                  :class="{ done: entry.terminal && !entry.terminal.isRunning, pinned: !entry.terminal }"
                >
                  {{
                    entry.terminal
                      ? (entry.terminal.isRunning ? 'Running' : 'Done')
                      : 'Pinned'
                  }}
                </span>
              </div>
              <code>{{ entry.command }}</code>
              <p :class="{ empty: !entry.terminal?.output.trim() }">
                {{ entry.terminal ? getTerminalPreview(entry.terminal) : 'Ready to start from anywhere.' }}
              </p>
            </div>
            <div class="active-terminal-actions">
              <AppButton
                v-if="entry.terminal || entry.pinnedScript"
                :icon="entry.terminal ? (entry.terminal.isRunning ? 'stop' : 'close') : 'play'"
                class="terminal-stop terminal-action-button"
                :variant="entry.terminal?.isRunning ? 'primary' : 'secondary'"
                :aria-label="
                  entry.terminal
                    ? `${entry.terminal.isRunning ? 'Stop' : 'Close'} ${entry.scriptName}`
                    : `Start ${entry.scriptName}`
                "
                :title="entry.terminal ? (entry.terminal.isRunning ? 'Stop script' : 'Close terminal') : 'Start script'"
                @click.stop="
                  entry.terminal
                    ? $emit('stop', entry.terminal.runId)
                    : entry.pinnedScript && $emit('startPinned', entry.pinnedScript)
                "
                @keydown.enter.stop
                @keydown.space.stop
              >
                {{
                  entry.terminal
                    ? (entry.terminal.isRunning ? 'Stop' : 'Close')
                    : 'Start'
                }}
              </AppButton>
              <AppButton
                v-if="entry.terminal"
                variant="secondary"
                size="icon"
                icon="restart"
                class="terminal-restart"
                :aria-label="`Restart ${entry.scriptName}`"
                title="Restart script"
                @click.stop="$emit('restart', entry.terminal.runId)"
                @keydown.enter.stop
                @keydown.space.stop
              >
                Restart
              </AppButton>
              <span
                v-else
                class="terminal-action-placeholder"
                aria-hidden="true"
              ></span>
              <AppButton
                v-if="entry.pinnedScript"
                variant="secondary"
                size="icon"
                icon="pin-off"
                class="terminal-pin"
                :aria-label="`Unpin ${entry.scriptName}`"
                title="Unpin script"
                @click.stop="$emit('unpinPinned', entry.pinnedScript)"
                @keydown.enter.stop
                @keydown.space.stop
              >
                Unpin
              </AppButton>
              <span
                v-else
                class="terminal-action-placeholder"
                aria-hidden="true"
              ></span>
            </div>
          </article>
        </div>
      </section>
    </div>

    <p v-else class="active-terminals-empty">No active or pinned scripts.</p>
  </aside>
</template>
