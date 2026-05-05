<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { parseAnsiOutput } from '../output-formatting'
import type { ScriptTerminal } from '../repositories'

const props = defineProps<{
  terminal: ScriptTerminal
}>()

defineEmits<{
  close: []
  stop: [runId: string]
  restart: [runId: string]
}>()

const outputElement = ref<HTMLPreElement | null>(null)
const outputSegments = computed(() => parseAnsiOutput(props.terminal.output))

function setOutputElement(element: Element | ComponentPublicInstance | null) {
  outputElement.value = element instanceof HTMLPreElement ? element : null
  scrollToBottom()
}

function scrollToBottom() {
  void nextTick(() => {
    if (!outputElement.value) {
      return
    }

    outputElement.value.scrollTop = outputElement.value.scrollHeight
  })
}

watch(
  () => props.terminal.output,
  () => {
    scrollToBottom()
  },
  { flush: 'post' },
)
</script>

<template>
  <div class="modal-backdrop terminal-modal-backdrop" role="presentation" @click.self="$emit('close')">
    <section
      class="terminal-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="terminal-modal-title"
    >
      <div class="terminal-modal-header">
        <div>
          <p>{{ terminal.repoName }}</p>
          <h2 id="terminal-modal-title">{{ terminal.scriptName }}</h2>
          <code>{{ terminal.command }}</code>
        </div>
        <span class="active-terminal-status" :class="{ done: !terminal.isRunning }">
          {{ terminal.isRunning ? 'Running' : 'Done' }}
        </span>
      </div>

      <pre :ref="setOutputElement" class="ansi-output"><template
        v-for="segment in outputSegments"
        :key="segment.key"
      ><span :class="segment.className">{{ segment.text }}</span></template></pre>

      <div class="terminal-modal-actions">
        <button type="button" class="secondary" @click="$emit('close')">Hide</button>
        <button type="button" class="secondary" @click="$emit('restart', terminal.runId)">
          Restart
        </button>
        <button
          type="button"
          class="terminal-stop"
          :class="{ secondary: !terminal.isRunning }"
          @click="$emit('stop', terminal.runId)"
        >
          {{ terminal.isRunning ? 'Stop' : 'Close' }}
        </button>
      </div>
    </section>
  </div>
</template>
