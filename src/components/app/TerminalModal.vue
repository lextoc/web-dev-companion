<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { parseAnsiOutput, plainTerminalText } from '../../output-formatting'
import type { ScriptTerminal } from '../../repositories'
import { AppButton } from '../ui'

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
const copyStatus = ref<'idle' | 'copied' | 'failed'>('idle')
let copyStatusTimeout: number | undefined

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

function resetCopyStatusSoon() {
  if (copyStatusTimeout !== undefined) {
    window.clearTimeout(copyStatusTimeout)
  }

  copyStatusTimeout = window.setTimeout(() => {
    copyStatus.value = 'idle'
    copyStatusTimeout = undefined
  }, 1800)
}

async function copyTerminalOutput() {
  try {
    await navigator.clipboard.writeText(plainTerminalText(props.terminal.output))
    copyStatus.value = 'copied'
  } catch {
    copyStatus.value = 'failed'
  }

  resetCopyStatusSoon()
}

onBeforeUnmount(() => {
  if (copyStatusTimeout !== undefined) {
    window.clearTimeout(copyStatusTimeout)
  }
})

const terminalStatus = computed(() => {
  if (props.terminal.isRunning) {
    return 'running'
  }

  if (props.terminal.signal) {
    return 'stopped'
  }

  if (props.terminal.exitCode !== null && props.terminal.exitCode !== undefined && props.terminal.exitCode !== 0) {
    return 'failed'
  }

  return 'done'
})

const terminalStatusLabel = computed(() => {
  if (terminalStatus.value === 'running') {
    return 'Running'
  }

  if (terminalStatus.value === 'failed') {
    return 'Failed'
  }

  if (terminalStatus.value === 'stopped') {
    return 'Stopped'
  }

  return 'Done'
})
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
          <h2 id="terminal-modal-title">{{ terminal.taskName }}</h2>
          <code>{{ terminal.command }}</code>
        </div>
        <span
          class="active-terminal-status"
          :class="{
            done: terminalStatus === 'done',
            failed: terminalStatus === 'failed',
            stopped: terminalStatus === 'stopped',
          }"
        >
          {{ terminalStatusLabel }}
        </span>
      </div>

      <pre :ref="setOutputElement" class="ansi-output"><template
        v-for="segment in outputSegments"
        :key="segment.key"
      ><span :class="segment.className">{{ segment.text }}</span></template></pre>

      <div class="terminal-modal-actions">
        <span class="terminal-copy-status" aria-live="polite">
          {{ copyStatus === 'copied' ? 'Copied output' : copyStatus === 'failed' ? 'Copy failed' : '' }}
        </span>
        <AppButton icon="copy" variant="secondary" @click="copyTerminalOutput">
          Copy output
        </AppButton>
        <AppButton variant="secondary" @click="$emit('close')">Hide</AppButton>
        <AppButton variant="secondary" @click="$emit('restart', terminal.runId)">
          Restart
        </AppButton>
        <AppButton
          class="terminal-stop"
          :variant="terminal.isRunning ? 'primary' : 'secondary'"
          @click="$emit('stop', terminal.runId)"
        >
          {{ terminal.isRunning ? 'Stop' : 'Close' }}
        </AppButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(4, 8, 12, 0.62);
}

.terminal-modal-backdrop {
  z-index: 30;
}

.terminal-modal {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(1040px, 100%);
  height: min(760px, calc(100vh - 48px));
  gap: 12px;
  border: 0;
  border-radius: 8px;
  padding: 16px;
  background: var(--terminal-panel);
  color: var(--terminal-text);
  box-shadow: none;
  -webkit-user-select: none;
  user-select: none;
}

.terminal-modal-header {
  display: flex;
  min-width: 0;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
}

.terminal-modal-header div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.terminal-modal-header p,
.terminal-modal-header h2 {
  margin: 0;
}

.terminal-modal-header p {
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-size-base);
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-modal-header h2 {
  overflow: hidden;
  color: var(--terminal-title);
  font-size: var(--font-size-title);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-modal-header code {
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-size-base);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-modal pre {
  min-height: 0;
  overflow: auto;
  border: 0;
  border-radius: 8px;
  margin: 0;
  padding: 12px;
  background: var(--terminal-bg);
  color: var(--terminal-text);
  font-size: var(--font-size-base);
  line-height: 1.55;
  -webkit-user-select: text;
  user-select: text;
}

.terminal-modal-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  justify-content: flex-end;
}

.terminal-copy-status {
  min-width: 92px;
  color: var(--muted);
  font-size: var(--font-size-base);
  font-weight: 700;
  text-align: right;
}

.terminal-stop {
  flex: 0 0 auto;
  min-height: 30px;
  border-color: var(--danger);
  padding: 0 10px;
  background: var(--danger);
  color: var(--danger-contrast);
}

.terminal-stop:hover:not(:disabled) {
  background: var(--danger-hover);
  color: var(--danger-contrast);
}

.ansi-output {
  color: var(--terminal-text);
}

.ansi-bold {
  font-weight: 800;
}

.ansi-dim {
  opacity: 0.68;
}

.ansi-fg-black {
  color: var(--ansi-black);
}

.ansi-fg-red,
.ansi-fg-bright-red {
  color: var(--ansi-red);
}

.ansi-fg-green,
.ansi-fg-bright-green {
  color: var(--ansi-green);
}

.ansi-fg-yellow,
.ansi-fg-bright-yellow {
  color: var(--ansi-yellow);
}

.ansi-fg-blue,
.ansi-fg-bright-blue {
  color: var(--ansi-blue);
}

.ansi-fg-magenta,
.ansi-fg-bright-magenta {
  color: var(--ansi-magenta);
}

.ansi-fg-cyan,
.ansi-fg-bright-cyan {
  color: var(--ansi-cyan);
}

.ansi-fg-white,
.ansi-fg-bright-white {
  color: var(--ansi-white);
}

.ansi-fg-bright-black {
  color: var(--ansi-bright-black);
}

@media (max-width: 760px) {
  .terminal-modal {
    height: calc(100vh - 32px);
    padding: 12px;
  }

  .terminal-modal-header,
  .terminal-modal-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
