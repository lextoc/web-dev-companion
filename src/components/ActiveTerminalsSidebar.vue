<script setup lang="ts">
import { computed } from 'vue'
import type { PinnedScript, ScriptTerminal } from '../repositories'

interface ActivityItem {
  id: string
  message: string
  time: string
  tone: 'success' | 'info'
}

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

const props = defineProps<{
  terminals: ScriptTerminal[]
  pinnedScripts: PinnedScript[]
  activityItems: ActivityItem[]
  collapsed: boolean
}>()

defineEmits<{
  toggle: []
  stop: [runId: string]
  restart: [runId: string]
  open: [runId: string]
  startPinned: [script: PinnedScript]
  unpinPinned: [script: PinnedScript]
}>()

const terminalGroups = computed<TerminalGroup[]>(() => {
  const entriesByKey = new Map<string, TerminalEntry>()

  for (const terminal of props.terminals) {
    entriesByKey.set(scriptKey(terminal.repoPath, terminal.scriptName), {
      key: scriptKey(terminal.repoPath, terminal.scriptName),
      repoName: terminal.repoName,
      scriptName: terminal.scriptName,
      command: terminal.command,
      terminal,
    })
  }

  for (const pinnedScript of props.pinnedScripts) {
    const key = scriptKey(pinnedScript.repoPath, pinnedScript.scriptName)
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

  const groups = new Map<string, TerminalEntry[]>()

  for (const entry of entriesByKey.values()) {
    const existingEntries = groups.get(entry.repoName) ?? []
    existingEntries.push(entry)
    groups.set(entry.repoName, existingEntries)
  }

  return [...groups.entries()]
    .sort(([repoNameA], [repoNameB]) => repoNameA.localeCompare(repoNameB))
    .map(([repoName, entries]) => ({
      repoName,
      runningCount: entries.filter((entry) => entry.terminal?.isRunning).length,
      doneCount: entries.filter((entry) => entry.terminal && !entry.terminal.isRunning).length,
      pinnedCount: entries.filter((entry) => entry.pinnedScript).length,
      entries: [...entries].sort((entryA, entryB) =>
        Number(Boolean(entryB.terminal?.isRunning)) - Number(Boolean(entryA.terminal?.isRunning))
        || Number(Boolean(entryB.terminal)) - Number(Boolean(entryA.terminal))
        || entryA.scriptName.localeCompare(entryB.scriptName),
      ),
    }))
})

const runningTerminalCount = computed(() =>
  props.terminals.filter((terminal) => terminal.isRunning).length,
)
const doneTerminalCount = computed(() => props.terminals.length - runningTerminalCount.value)
const pinnedIdleCount = computed(() =>
  props.pinnedScripts.filter((pinnedScript) =>
    !props.terminals.some((terminal) =>
      terminal.repoPath === pinnedScript.repoPath && terminal.scriptName === pinnedScript.scriptName,
    ),
  ).length,
)
const sidebarScriptCount = computed(() => props.terminals.length + pinnedIdleCount.value)

function scriptKey(repoPath: string, scriptName: string) {
  return `${repoPath}\n${scriptName}`
}

function getTerminalPreview(terminal: ScriptTerminal) {
  const outputLines = terminal.output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const lastLine = outputLines[outputLines.length - 1]

  if (lastLine) {
    return lastLine
  }

  return terminal.isRunning ? 'Waiting for output...' : 'No output captured.'
}
</script>

<template>
  <aside class="active-terminals" :class="{ collapsed }" aria-label="Active terminal scripts">
    <button
      v-if="collapsed"
      type="button"
      class="secondary active-terminals-rail"
      aria-label="Show active terminals"
      title="Show active terminals"
      @click="$emit('toggle')"
    >
      <span class="terminal-mini-dot" :class="{ running: runningTerminalCount > 0 }"></span>
      <strong>{{ sidebarScriptCount }}</strong>
      <small>{{ runningTerminalCount }} running</small>
      <small v-if="doneTerminalCount">{{ doneTerminalCount }} done</small>
      <small v-if="pinnedIdleCount">{{ pinnedIdleCount }} pinned</small>
    </button>

    <div v-else class="active-terminals-heading">
      <div class="active-terminals-title">
        <h2>Scripts</h2>
        <span>{{ sidebarScriptCount }}</span>
      </div>
      <button
        type="button"
        class="secondary terminal-collapse"
        aria-label="Hide active terminals"
        title="Hide active terminals"
        @click="$emit('toggle')"
      >
        Hide
      </button>
    </div>

    <div v-if="terminalGroups.length && !collapsed" class="active-terminal-groups">
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
              <button
                v-if="entry.pinnedScript && !entry.terminal"
                type="button"
                class="secondary terminal-restart"
                @click.stop="$emit('startPinned', entry.pinnedScript)"
                @keydown.enter.stop
                @keydown.space.stop
              >
                Start
              </button>
              <button
                v-if="entry.pinnedScript"
                type="button"
                class="secondary terminal-pin"
                @click.stop="$emit('unpinPinned', entry.pinnedScript)"
                @keydown.enter.stop
                @keydown.space.stop
              >
                Unpin
              </button>
              <button
                v-if="entry.terminal"
                type="button"
                class="secondary terminal-restart"
                @click.stop="$emit('restart', entry.terminal.runId)"
                @keydown.enter.stop
                @keydown.space.stop
              >
                Restart
              </button>
              <button
                v-if="entry.terminal"
                type="button"
                class="terminal-stop"
                :class="{ secondary: !entry.terminal.isRunning }"
                @click.stop="$emit('stop', entry.terminal.runId)"
                @keydown.enter.stop
                @keydown.space.stop
              >
                {{ entry.terminal.isRunning ? 'Stop' : 'Close' }}
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <p v-else-if="!collapsed" class="active-terminals-empty">No active or pinned scripts.</p>

    <section v-if="activityItems.length && !collapsed" class="activity-log">
      <h3>Recent activity</h3>
      <ol>
        <li v-for="activity in activityItems" :key="activity.id" :class="activity.tone">
          <span>{{ activity.message }}</span>
          <time>{{ activity.time }}</time>
        </li>
      </ol>
    </section>
  </aside>
</template>
