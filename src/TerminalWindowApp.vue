<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { TerminalModal } from './components/app'
import { AppButton } from './components/ui'
import { useSettings } from './composables/useSettings'
import type { ScriptTerminal } from './repositories'

const terminal = ref<ScriptTerminal | null>(null)
const terminalRunId = ref(new URLSearchParams(window.location.search).get('terminalRunId') ?? '')
const isMacPlatform = ref(navigator.platform.toLowerCase().includes('mac'))
const windowPlatform = ref<'mac' | 'windows' | 'other'>(isMacPlatform.value ? 'mac' : 'other')
const { loadAppSettings } = useSettings()
let removeTerminalWindowStateListener: (() => void) | undefined

const windowTitle = computed(() => {
  if (!terminal.value) {
    return 'Terminal'
  }

  return `${terminal.value.taskName} - ${terminal.value.repoName}`
})
const closeWindowShortcutLabel = computed(() => (isMacPlatform.value ? '⌘W' : 'Ctrl+W'))

function closeWindow() {
  window.close()
}

function stopTerminal(runId: string) {
  window.desktop.sendTerminalWindowAction({
    action: 'stop',
    runId,
  })
}

function restartTerminal(runId: string) {
  window.desktop.sendTerminalWindowAction({
    action: 'restart',
    runId,
  })
}

function isCloseWindowShortcut(event: KeyboardEvent) {
  const key = event.key.toLowerCase()

  return (
    key === 'w' &&
    !event.altKey &&
    !event.shiftKey &&
    ((event.metaKey && !event.ctrlKey) || (event.ctrlKey && !event.metaKey))
  )
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' && !isCloseWindowShortcut(event)) {
    return
  }

  event.preventDefault()
  closeWindow()
}

function syncPlatformDataset() {
  const platformName = navigator.platform.toLowerCase()
  isMacPlatform.value = platformName.includes('mac')
  windowPlatform.value = isMacPlatform.value
    ? 'mac'
    : platformName.includes('win')
      ? 'windows'
      : 'other'
  document.documentElement.dataset.platform = windowPlatform.value
}

onMounted(async () => {
  syncPlatformDataset()
  await loadAppSettings()
  document.title = windowTitle.value
  removeTerminalWindowStateListener = window.desktop.onTerminalWindowState((snapshot) => {
    terminalRunId.value = snapshot.runId
    terminal.value = snapshot.terminal
    document.title = windowTitle.value
  })

  if (terminalRunId.value) {
    window.desktop.requestTerminalWindowState(terminalRunId.value)
  }

  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  removeTerminalWindowStateListener?.()
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <TerminalModal
    v-if="terminal"
    mode="window"
    :terminal="terminal"
    :close-shortcut-label="closeWindowShortcutLabel"
    :window-platform="windowPlatform"
    @close="closeWindow"
    @stop="stopTerminal"
    @restart="restartTerminal"
  />

  <main v-else class="terminal-window-empty">
    <section>
      <p>Terminal unavailable</p>
      <h1>This task terminal is no longer open.</h1>
      <AppButton class="terminal-window-empty-close" variant="secondary" @click="closeWindow">
        Close window
        <kbd>{{ closeWindowShortcutLabel }}</kbd>
      </AppButton>
    </section>
  </main>
</template>

<style scoped>
.terminal-window-empty {
  display: grid;
  width: 100vw;
  height: 100vh;
  place-items: center;
  padding: 24px;
  background: var(--terminal-panel);
  color: var(--terminal-text);
}

.terminal-window-empty section {
  display: grid;
  max-width: 520px;
  gap: 14px;
  justify-items: start;
}

.terminal-window-empty p,
.terminal-window-empty h1 {
  margin: 0;
}

.terminal-window-empty p {
  color: var(--muted);
  font-size: var(--font-size-base);
  font-weight: 800;
}

.terminal-window-empty h1 {
  color: var(--terminal-title);
  font-size: var(--font-size-title);
}

.terminal-window-empty-close {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.terminal-window-empty-close kbd {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 900;
}
</style>
