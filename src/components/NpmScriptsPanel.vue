<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import type { ScriptTerminal } from '../repositories'

const props = defineProps<{
  npmScripts: [string, string][]
  pinnedScriptNames: string[]
  scriptTerminalsByScript: Record<string, ScriptTerminal>
}>()

defineEmits<{
  run: [scriptName: string]
  stop: [scriptName: string]
  restart: [scriptName: string]
  open: [scriptName: string]
  togglePin: [scriptName: string]
}>()

const terminalOutputElements = ref<Record<string, HTMLPreElement>>({})
const pinnedScriptNameSet = computed(() => new Set(props.pinnedScriptNames))

function isPinned(scriptName: string) {
  return pinnedScriptNameSet.value.has(scriptName)
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

watch(
  () => props.scriptTerminalsByScript,
  () => {
    for (const scriptName of Object.keys(props.scriptTerminalsByScript)) {
      scrollTerminalToBottom(scriptName)
    }
  },
  { deep: true, flush: 'post' },
)
</script>

<template>
  <section class="detail-panel scripts-panel">
    <div class="panel-heading">
      <h3>NPM scripts</h3>
    </div>
    <div v-if="npmScripts.length" class="script-list">
      <div v-for="[scriptName, command] in npmScripts" :key="scriptName" class="script-item">
        <div
          v-if="scriptTerminalsByScript[scriptName]"
          class="script-terminal"
          role="button"
          tabindex="0"
          title="Open full terminal"
          @click="$emit('open', scriptName)"
          @keydown.enter="$emit('open', scriptName)"
          @keydown.space.prevent="$emit('open', scriptName)"
        >
          <div class="terminal-toolbar">
            <code>{{ scriptTerminalsByScript[scriptName].command }}</code>
            <div class="terminal-actions">
              <button
                type="button"
                class="secondary terminal-pin"
                :class="{ active: isPinned(scriptName) }"
                @click.stop="$emit('togglePin', scriptName)"
                @keydown.enter.stop
                @keydown.space.stop
              >
                {{ isPinned(scriptName) ? 'Unpin' : 'Pin' }}
              </button>
              <button
                type="button"
                class="secondary terminal-restart"
                @click.stop="$emit('restart', scriptName)"
                @keydown.enter.stop
                @keydown.space.stop
              >
                Restart
              </button>
              <button
                type="button"
                class="terminal-stop"
                :class="{ secondary: !scriptTerminalsByScript[scriptName].isRunning }"
                @click.stop="$emit('stop', scriptName)"
                @keydown.enter.stop
                @keydown.space.stop
              >
                {{ scriptTerminalsByScript[scriptName].isRunning ? 'Stop' : 'Close' }}
              </button>
            </div>
          </div>
          <pre :ref="(element) => setTerminalOutputElement(scriptName, element)">{{ scriptTerminalsByScript[scriptName].output }}</pre>
        </div>

        <div
          v-else
          class="script-row"
          role="button"
          tabindex="0"
          @click="$emit('run', scriptName)"
          @keydown.enter="$emit('run', scriptName)"
          @keydown.space.prevent="$emit('run', scriptName)"
        >
          <div class="script-row-heading">
            <code>{{ scriptName }}</code>
            <button
              type="button"
              class="secondary script-pin-button"
              :class="{ active: isPinned(scriptName) }"
              @click.stop="$emit('togglePin', scriptName)"
              @keydown.enter.stop
              @keydown.space.stop
            >
              {{ isPinned(scriptName) ? 'Pinned' : 'Pin' }}
            </button>
          </div>
          <span>{{ command }}</span>
        </div>
      </div>
    </div>
    <p v-else class="muted">No scripts found.</p>
  </section>
</template>
