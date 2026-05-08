<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { parseAnsiOutput } from '../../../output-formatting'
import type { ScriptTerminal } from '../../../repositories'
import { AppButton, AppIcon } from '../../ui'

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

<style scoped>
.script-command-center {
  display: grid;
  gap: 18px;
  align-content: start;
}

.detail-panel.scripts-panel {
  gap: 16px;
  padding: 14px;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--brand) 6%, transparent),
      transparent 38%
    ),
    color-mix(in srgb, var(--surface) 74%, var(--app-bg));
}

.scripts-panel .panel-heading {
  align-items: stretch;
  flex-wrap: wrap;
}

.script-overview-stats {
  display: grid;
  grid-auto-columns: minmax(88px, auto);
  grid-auto-flow: column;
  gap: 8px;
  align-items: stretch;
}

.script-overview-stat {
  display: grid;
  min-width: 88px;
  align-content: center;
  gap: 1px;
  border-radius: 7px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--surface-soft) 66%, var(--surface));
}

.script-overview-stat strong {
  color: var(--text);
  font-size: var(--font-size-title);
  font-weight: 900;
  line-height: 1.1;
}

.script-overview-stat span {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.script-group {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.script-group-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border-soft) 72%, transparent);
  padding-bottom: 8px;
}

.script-group-heading h4 {
  margin-bottom: 0;
  color: var(--text);
  font-size: var(--font-size-base);
  font-weight: 900;
  text-transform: uppercase;
}

.script-group-heading span {
  display: block;
  margin-top: 1px;
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
}

.script-group-heading strong {
  display: grid;
  min-width: 28px;
  height: 24px;
  place-items: center;
  border-radius: 999px;
  padding: 0 8px;
  background: color-mix(in srgb, var(--brand-ring) 64%, var(--surface));
  color: var(--brand-text-hover);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.script-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 11px;
}

.script-item {
  display: grid;
  height: 214px;
  max-height: 214px;
  min-height: 0;
}

.scripts-panel .script-row {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  align-items: stretch;
  height: 100%;
  width: 100%;
  min-height: 0;
  border-radius: 8px;
  padding: 11px 12px 12px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface) 92%, transparent),
      color-mix(in srgb, var(--surface-soft) 52%, var(--surface))
    );
  color: var(--text);
  cursor: pointer;
  font-weight: 400;
  text-align: left;
  transition:
    background-color 140ms ease,
    color 140ms ease,
    transform 140ms ease;
}

.scripts-panel .script-row:hover:not(:disabled) {
  background: color-mix(in srgb, var(--surface-hover) 72%, var(--surface));
  color: var(--text);
  box-shadow: none;
  transform: translateY(-1px);
}

.script-row:hover:not(:disabled) code {
  color: var(--brand-text-hover);
}

.script-row:hover:not(:disabled) .script-command {
  color: var(--muted-strong);
}

.script-row:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}

.script-row-heading {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.script-row-title,
.terminal-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.script-row-title code,
.terminal-title code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.script-run-icon,
.terminal-title-icon {
  display: grid;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 6px;
}

.script-run-icon {
  background: color-mix(in srgb, var(--success-soft) 74%, var(--surface));
  color: var(--success-text);
}

.terminal-title-icon {
  background: color-mix(in srgb, var(--terminal-surface) 82%, var(--surface));
  color: var(--terminal-title);
}

.script-run-icon :deep(.app-icon),
.terminal-title-icon :deep(.app-icon) {
  width: 14px;
  height: 14px;
}

.script-pin-button,
.terminal-pin {
  min-height: 30px;
  padding: 0 10px;
  font-size: var(--font-size-compact);
}

.script-pin-button.active,
.terminal-pin.active {
  border-color: color-mix(in srgb, var(--success-text) 44%, transparent);
  background: var(--success-soft);
  color: var(--success-text);
}

.scripts-panel code {
  color: var(--brand);
  font-weight: 800;
  overflow-wrap: anywhere;
}

.script-command {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-size-base);
  line-height: 1.42;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
}

.scripts-panel .script-item.is-pinned .script-row {
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--success-soft) 74%, transparent),
      transparent 42%
    ),
    color-mix(in srgb, var(--surface) 82%, var(--app-bg));
}

.scripts-panel .script-terminal {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  height: 100%;
  max-height: 214px;
  min-height: 0;
  overflow: hidden;
  border-radius: 8px;
  padding: 9px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--terminal-panel) 88%, var(--surface)),
      var(--terminal-panel)
    );
  cursor: pointer;
  transition:
    background-color 140ms ease,
    transform 140ms ease;
}

.scripts-panel .script-terminal:hover {
  background: color-mix(in srgb, var(--terminal-panel) 70%, var(--surface-hover));
  transform: translateY(-1px);
}

.script-terminal:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}

.terminal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.terminal-title {
  flex: 1 1 auto;
}

.terminal-toolbar code {
  min-width: 0;
  overflow: hidden;
  color: var(--terminal-title);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}

.terminal-restart {
  min-height: 30px;
  padding: 0 10px;
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

.terminal-actions .subtle-icon-button,
.script-row-heading .subtle-icon-button {
  width: 30px;
  min-height: 30px;
  padding: 0;
}

.terminal-actions .terminal-action-button {
  min-height: 30px;
}

.script-terminal pre {
  min-height: 0;
  max-height: none;
  overflow: auto;
  border-radius: 6px;
  padding: 9px;
  background: var(--terminal-bg);
  font-size: var(--font-size-compact);
  line-height: 1.5;
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

.scripts-panel .script-row,
.scripts-panel .script-terminal {
  border: 0;
  box-shadow: none;
}

.scripts-panel .script-row {
  background: color-mix(in srgb, var(--surface) 68%, var(--app-bg));
}

.scripts-panel .script-row:hover:not(:disabled),
.scripts-panel .script-terminal:hover {
  background: color-mix(in srgb, var(--surface-hover) 58%, transparent);
}

.terminal-stop:not(.secondary) {
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--danger) 90%, #fff),
      var(--danger)
    );
}

@media (max-width: 760px) {
  .script-list {
    grid-template-columns: 1fr;
  }

  .script-overview-stats {
    width: 100%;
    grid-auto-flow: initial;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .script-overview-stat {
    min-width: 0;
  }

  .script-group-heading {
    grid-template-columns: 1fr;
    align-items: stretch;
    flex-direction: column;
  }

  .script-group-heading strong {
    width: fit-content;
  }

  .terminal-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .terminal-actions {
    width: 100%;
  }

  .terminal-actions button {
    flex: 1 1 0;
  }
}

@media (min-width: 761px) and (max-width: 1180px) {
  .script-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
