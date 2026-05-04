<script setup lang="ts">
import { computed } from 'vue'
import type { ScriptTerminal } from '../repositories'

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
  terminals: ScriptTerminal[]
}

const props = defineProps<{
  terminals: ScriptTerminal[]
  activityItems: ActivityItem[]
  collapsed: boolean
}>()

defineEmits<{
  toggle: []
  stop: [runId: string]
}>()

const terminalGroups = computed<TerminalGroup[]>(() => {
  const groups = new Map<string, ScriptTerminal[]>()

  for (const terminal of props.terminals) {
    const existingTerminals = groups.get(terminal.repoName) ?? []
    existingTerminals.push(terminal)
    groups.set(terminal.repoName, existingTerminals)
  }

  return [...groups.entries()]
    .sort(([repoNameA], [repoNameB]) => repoNameA.localeCompare(repoNameB))
    .map(([repoName, terminals]) => ({
      repoName,
      runningCount: terminals.filter((terminal) => terminal.isRunning).length,
      doneCount: terminals.filter((terminal) => !terminal.isRunning).length,
      terminals: [...terminals].sort((terminalA, terminalB) =>
        Number(terminalB.isRunning) - Number(terminalA.isRunning)
        || terminalA.scriptName.localeCompare(terminalB.scriptName),
      ),
    }))
})

const runningTerminalCount = computed(() =>
  props.terminals.filter((terminal) => terminal.isRunning).length,
)
const doneTerminalCount = computed(() => props.terminals.length - runningTerminalCount.value)

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
      <strong>{{ terminals.length }}</strong>
      <small>{{ runningTerminalCount }} running</small>
      <small v-if="doneTerminalCount">{{ doneTerminalCount }} done</small>
    </button>

    <div v-else class="active-terminals-heading">
      <div class="active-terminals-title">
        <h2>Active terminals</h2>
        <span>{{ terminals.length }}</span>
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
          </span>
        </div>
        <div class="active-terminal-list">
          <article v-for="terminal in group.terminals" :key="terminal.runId" class="active-terminal-item">
            <div class="active-terminal-main">
              <div class="active-terminal-item-heading">
                <strong>{{ terminal.scriptName }}</strong>
                <span class="active-terminal-status" :class="{ done: !terminal.isRunning }">
                  {{ terminal.isRunning ? 'Running' : 'Done' }}
                </span>
              </div>
              <code>{{ terminal.command }}</code>
              <p :class="{ empty: !terminal.output.trim() }">
                {{ getTerminalPreview(terminal) }}
              </p>
            </div>
            <button
              type="button"
              class="terminal-stop"
              :class="{ secondary: !terminal.isRunning }"
              @click="$emit('stop', terminal.runId)"
            >
              {{ terminal.isRunning ? 'Stop' : 'Close' }}
            </button>
          </article>
        </div>
      </section>
    </div>

    <p v-else-if="!collapsed" class="active-terminals-empty">No terminal sessions.</p>

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
