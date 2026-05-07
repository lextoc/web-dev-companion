<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { parseAnsiOutput } from '../output-formatting'
import type { ScriptTerminal } from '../repositories'
import { AppButton, AppIcon } from './ui'

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
const terminalOutputSegmentsByScript = computed(() =>
  Object.fromEntries(
    Object.entries(props.scriptTerminalsByScript).map(([scriptName, terminal]) => [
      scriptName,
      parseAnsiOutput(terminal.output),
    ]),
  ),
)
const runningScriptCount = computed(() => Object.keys(props.scriptTerminalsByScript).length)
const pinnedScriptCount = computed(() =>
  props.npmScripts.filter(([scriptName]) => isPinned(scriptName)).length,
)
const scriptOverviewStats = computed(() => [
  { key: 'available', label: 'Available', value: props.npmScripts.length },
  { key: 'pinned', label: 'Pinned', value: pinnedScriptCount.value },
  { key: 'running', label: 'Running', value: runningScriptCount.value },
])

function scriptCategory(scriptName: string) {
  if (/dev|start|serve|watch/i.test(scriptName)) {
    return 'dev'
  }

  if (/test|spec|lint|type|check|format/i.test(scriptName)) {
    return 'quality'
  }

  if (/build|preview|package|release|dist/i.test(scriptName)) {
    return 'build'
  }

  return 'other'
}

const scriptGroups = computed(() => {
  const pinnedScripts = props.npmScripts.filter(([scriptName]) => isPinned(scriptName))
  const regularScripts = props.npmScripts.filter(([scriptName]) => !isPinned(scriptName))
  const groups = [
    {
      key: 'pinned',
      title: 'Pinned',
      description: 'Available from the sidebar',
      scripts: pinnedScripts,
    },
    {
      key: 'dev',
      title: 'Dev',
      description: 'Run local servers and watchers',
      scripts: regularScripts.filter(([scriptName]) => scriptCategory(scriptName) === 'dev'),
    },
    {
      key: 'quality',
      title: 'Quality',
      description: 'Tests, checks, linting, and formatting',
      scripts: regularScripts.filter(([scriptName]) => scriptCategory(scriptName) === 'quality'),
    },
    {
      key: 'build',
      title: 'Build',
      description: 'Build, preview, package, and release',
      scripts: regularScripts.filter(([scriptName]) => scriptCategory(scriptName) === 'build'),
    },
  ]

  return [
    ...groups,
    {
      key: 'other',
      title: 'Other',
      description: 'Project-specific commands',
      scripts: regularScripts.filter(([scriptName]) => scriptCategory(scriptName) === 'other'),
    },
  ].filter((group) => group.scripts.length > 0)
})

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
      <div>
        <h3>NPM scripts</h3>
        <span class="panel-subtitle">{{ npmScripts.length }} available commands</span>
      </div>
      <div v-if="npmScripts.length" class="script-overview-stats" aria-label="Script overview">
        <div v-for="stat in scriptOverviewStats" :key="stat.key" class="script-overview-stat">
          <strong>{{ stat.value }}</strong>
          <span>{{ stat.label }}</span>
        </div>
      </div>
    </div>
    <div v-if="npmScripts.length" class="script-command-center">
      <section
        v-for="group in scriptGroups"
        :key="group.key"
        class="script-group"
        :class="`script-group-${group.key}`"
      >
        <div class="script-group-heading">
          <div>
            <h4>{{ group.title }}</h4>
            <span>{{ group.description }}</span>
          </div>
          <strong>{{ group.scripts.length }}</strong>
        </div>

        <div class="script-list">
          <div
            v-for="[scriptName, command] in group.scripts"
            :key="scriptName"
            class="script-item"
            :class="{
              'is-running': Boolean(scriptTerminalsByScript[scriptName]),
              'is-pinned': isPinned(scriptName),
            }"
          >
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
                <div class="terminal-title">
                  <span class="terminal-title-icon">
                    <AppIcon name="terminal" />
                  </span>
                  <code>{{ scriptTerminalsByScript[scriptName].command }}</code>
                </div>
                <div class="terminal-actions">
                  <AppButton
                    variant="secondary"
                    size="icon"
                    :icon="isPinned(scriptName) ? 'pin-off' : 'pin'"
                    class="terminal-pin"
                    :active="isPinned(scriptName)"
                    :aria-label="`${isPinned(scriptName) ? 'Unpin' : 'Pin'} ${scriptName}`"
                    :title="isPinned(scriptName) ? 'Unpin script' : 'Pin script'"
                    @click.stop="$emit('togglePin', scriptName)"
                    @keydown.enter.stop
                    @keydown.space.stop
                  >
                    {{ isPinned(scriptName) ? 'Unpin' : 'Pin' }}
                  </AppButton>
                  <AppButton
                    variant="secondary"
                    size="icon"
                    icon="restart"
                    class="terminal-restart"
                    :aria-label="`Restart ${scriptName}`"
                    title="Restart script"
                    @click.stop="$emit('restart', scriptName)"
                    @keydown.enter.stop
                    @keydown.space.stop
                  >
                    Restart
                  </AppButton>
                  <AppButton
                    :icon="scriptTerminalsByScript[scriptName].isRunning ? 'stop' : 'close'"
                    class="terminal-stop terminal-action-button"
                    :variant="scriptTerminalsByScript[scriptName].isRunning ? 'primary' : 'secondary'"
                    :aria-label="`${scriptTerminalsByScript[scriptName].isRunning ? 'Stop' : 'Close'} ${scriptName}`"
                    @click.stop="$emit('stop', scriptName)"
                    @keydown.enter.stop
                    @keydown.space.stop
                  >
                    {{ scriptTerminalsByScript[scriptName].isRunning ? 'Stop' : 'Close' }}
                  </AppButton>
                </div>
              </div>
              <pre :ref="(element) => setTerminalOutputElement(scriptName, element)" class="ansi-output"><template
                v-for="segment in terminalOutputSegmentsByScript[scriptName]"
                :key="`${scriptName}-${segment.key}`"
              ><span :class="segment.className">{{ segment.text }}</span></template></pre>
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
                <div class="script-row-title">
                  <span class="script-run-icon">
                    <AppIcon name="play" />
                  </span>
                  <code>{{ scriptName }}</code>
                </div>
                <AppButton
                  variant="secondary"
                  size="icon"
                  :icon="isPinned(scriptName) ? 'pin-off' : 'pin'"
                  class="script-pin-button"
                  :active="isPinned(scriptName)"
                  :aria-label="`${isPinned(scriptName) ? 'Unpin' : 'Pin'} ${scriptName}`"
                  :title="isPinned(scriptName) ? 'Unpin script' : 'Pin script'"
                  @click.stop="$emit('togglePin', scriptName)"
                  @keydown.enter.stop
                  @keydown.space.stop
                >
                  {{ isPinned(scriptName) ? 'Unpin' : 'Pin' }}
                </AppButton>
              </div>
              <span class="script-command">{{ command }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
    <p v-else class="muted">No scripts found.</p>
  </section>
</template>
