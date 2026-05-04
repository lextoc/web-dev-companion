<script setup lang="ts">
import { computed } from 'vue'
import type { ScriptTerminal } from '../repositories'

interface ActivityItem {
  id: string
  message: string
  time: string
  tone: 'success' | 'info'
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

const terminalGroups = computed(() => {
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
      terminals: [...terminals].sort((terminalA, terminalB) =>
        terminalA.scriptName.localeCompare(terminalB.scriptName),
      ),
    }))
})

const runningTerminalCount = computed(() =>
  props.terminals.filter((terminal) => terminal.isRunning).length,
)
</script>

<template>
  <aside class="active-terminals" :class="{ collapsed }" aria-label="Active terminal scripts">
    <div class="active-terminals-heading">
      <h2 v-if="!collapsed">Active terminals</h2>
      <span>{{ terminals.length }}</span>
      <button
        type="button"
        class="secondary terminal-collapse"
        :title="collapsed ? 'Show active terminals' : 'Hide active terminals'"
        @click="$emit('toggle')"
      >
        {{ collapsed ? 'Show' : 'Hide' }}
      </button>
    </div>

    <div v-if="collapsed" class="active-terminals-mini" aria-label="Terminal activity">
      <span class="terminal-mini-dot" :class="{ running: runningTerminalCount > 0 }"></span>
      <strong>{{ runningTerminalCount }}</strong>
      <small>running</small>
    </div>

    <section v-if="activityItems.length && !collapsed" class="activity-log">
      <h3>Activity</h3>
      <ol>
        <li v-for="activity in activityItems" :key="activity.id" :class="activity.tone">
          <span>{{ activity.message }}</span>
          <time>{{ activity.time }}</time>
        </li>
      </ol>
    </section>

    <div v-if="terminalGroups.length && !collapsed" class="active-terminal-groups">
      <section v-for="group in terminalGroups" :key="group.repoName" class="active-terminal-group">
        <h3>{{ group.repoName }}</h3>
        <div class="active-terminal-list">
          <article v-for="terminal in group.terminals" :key="terminal.runId" class="active-terminal-item">
            <div>
              <strong>{{ terminal.scriptName }}</strong>
              <code>{{ terminal.command }}</code>
            </div>
            <span class="active-terminal-status" :class="{ done: !terminal.isRunning }">
              {{ terminal.isRunning ? 'Running' : 'Done' }}
            </span>
            <button type="button" class="terminal-stop" @click="$emit('stop', terminal.runId)">
              {{ terminal.isRunning ? 'Stop' : 'Close' }}
            </button>
          </article>
        </div>
      </section>
    </div>

    <p v-else-if="!collapsed" class="active-terminals-empty">No active terminals.</p>
  </aside>
</template>
