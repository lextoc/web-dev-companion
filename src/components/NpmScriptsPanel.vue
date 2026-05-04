<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import type { ScriptTerminal } from '../repositories'

const props = defineProps<{
  npmScripts: [string, string][]
  scriptTerminals: Record<string, ScriptTerminal>
}>()

defineEmits<{
  run: [scriptName: string]
  stop: [scriptName: string]
}>()

const terminalOutputElements = ref<Record<string, HTMLPreElement>>({})

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
  () => props.scriptTerminals,
  () => {
    for (const scriptName of Object.keys(props.scriptTerminals)) {
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
        <div v-if="scriptTerminals[scriptName]" class="script-terminal">
          <div class="terminal-toolbar">
            <code>{{ scriptTerminals[scriptName].command }}</code>
            <button type="button" class="terminal-stop" @click="$emit('stop', scriptName)">
              Stop
            </button>
          </div>
          <pre :ref="(element) => setTerminalOutputElement(scriptName, element)">{{ scriptTerminals[scriptName].output }}</pre>
        </div>

        <button v-else class="script-row" type="button" @click="$emit('run', scriptName)">
          <code>{{ scriptName }}</code>
          <span>{{ command }}</span>
        </button>
      </div>
    </div>
    <p v-else class="muted">No scripts found.</p>
  </section>
</template>
