<script setup lang="ts">
import { computed } from 'vue'
import type { ScriptTerminal } from '../repositories'

const props = defineProps<{
  terminals: ScriptTerminal[]
}>()

defineEmits<{
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
</script>

<template>
  <aside class="active-terminals" aria-label="Active terminal scripts">
    <div class="active-terminals-heading">
      <h2>Active terminals</h2>
      <span>{{ terminals.length }}</span>
    </div>

    <div v-if="terminalGroups.length" class="active-terminal-groups">
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

    <p v-else class="active-terminals-empty">No active terminals.</p>
  </aside>
</template>
