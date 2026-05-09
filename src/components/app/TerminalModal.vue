<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { ComponentPublicInstance } from "vue";
import { parseAnsiOutput, plainTerminalText } from "../../output-formatting";
import type { ScriptTerminal } from "../../repositories";
import { AppButton } from "../ui";

const props = defineProps<{
  closeShortcutLabel?: string;
  mode?: "modal" | "window";
  terminal: ScriptTerminal;
}>();

defineEmits<{
  close: [];
  stop: [runId: string];
  restart: [runId: string];
}>();

const outputElement = ref<HTMLPreElement | null>(null);
const outputSegments = computed(() => parseAnsiOutput(props.terminal.output));
const copyStatus = ref<"idle" | "copied" | "failed">("idle");
let copyStatusTimeout: number | undefined;

function setOutputElement(element: Element | ComponentPublicInstance | null) {
  outputElement.value = element instanceof HTMLPreElement ? element : null;
  scrollToBottom();
}

function scrollToBottom() {
  void nextTick(() => {
    if (!outputElement.value) {
      return;
    }

    outputElement.value.scrollTop = outputElement.value.scrollHeight;
  });
}

watch(
  () => props.terminal.output,
  () => {
    scrollToBottom();
  },
  { flush: "post" },
);

function resetCopyStatusSoon() {
  if (copyStatusTimeout !== undefined) {
    window.clearTimeout(copyStatusTimeout);
  }

  copyStatusTimeout = window.setTimeout(() => {
    copyStatus.value = "idle";
    copyStatusTimeout = undefined;
  }, 1800);
}

async function copyTerminalOutput() {
  try {
    await navigator.clipboard.writeText(
      plainTerminalText(props.terminal.output),
    );
    copyStatus.value = "copied";
  } catch {
    copyStatus.value = "failed";
  }

  resetCopyStatusSoon();
}

function controlTerminalWindow(
  action: "close" | "minimize" | "toggle-maximize",
) {
  window.desktop.controlTerminalWindow(action);
}

onBeforeUnmount(() => {
  if (copyStatusTimeout !== undefined) {
    window.clearTimeout(copyStatusTimeout);
  }
});

const terminalStatus = computed(() => {
  if (props.terminal.isRunning) {
    return "running";
  }

  if (props.terminal.signal) {
    return "stopped";
  }

  if (
    props.terminal.exitCode !== null &&
    props.terminal.exitCode !== undefined &&
    props.terminal.exitCode !== 0
  ) {
    return "failed";
  }

  return "done";
});

const terminalStatusLabel = computed(() => {
  if (terminalStatus.value === "running") {
    return "Running";
  }

  if (terminalStatus.value === "failed") {
    return "Failed";
  }

  if (terminalStatus.value === "stopped") {
    return "Stopped";
  }

  return "Done";
});

const isWindowMode = computed(() => props.mode === "window");
</script>

<template>
  <div
    :class="
      isWindowMode
        ? 'terminal-window-shell'
        : 'modal-backdrop terminal-modal-backdrop'
    "
    role="presentation"
    @click.self="!isWindowMode && $emit('close')"
  >
    <div
      v-if="isWindowMode"
      class="terminal-window-titlebar"
      role="presentation"
      @dblclick="controlTerminalWindow('toggle-maximize')"
    >
      <div class="terminal-window-controls" @dblclick.stop>
        <button
          class="terminal-window-control close"
          type="button"
          aria-label="Close window"
          title="Close"
          @click.stop="controlTerminalWindow('close')"
        />
        <button
          class="terminal-window-control minimize"
          type="button"
          aria-label="Minimize window"
          title="Minimize"
          @click.stop="controlTerminalWindow('minimize')"
        />
        <button
          class="terminal-window-control maximize"
          type="button"
          aria-label="Maximize window"
          title="Maximize"
          @click.stop="controlTerminalWindow('toggle-maximize')"
        />
      </div>
      <strong class="terminal-window-app-title">web-dev-companion</strong>
    </div>

    <section
      :class="isWindowMode ? 'terminal-window' : 'terminal-modal'"
      role="dialog"
      :aria-modal="isWindowMode ? undefined : true"
      aria-labelledby="terminal-modal-title"
    >
      <div v-if="isWindowMode" class="terminal-window-header">
        <div>
          <h2 id="terminal-modal-title">{{ terminal.taskName }}</h2>
          <code>{{ terminal.command }}</code>
        </div>
        <span
          class="terminal-status"
          :class="{
            done: terminalStatus === 'done',
            failed: terminalStatus === 'failed',
            stopped: terminalStatus === 'stopped',
          }"
        >
          {{ terminalStatusLabel }}
        </span>
      </div>

      <div v-if="!isWindowMode" class="terminal-modal-header">
        <div>
          <p>{{ terminal.repoName }}</p>
          <h2 id="terminal-modal-title">{{ terminal.taskName }}</h2>
          <code>{{ terminal.command }}</code>
        </div>
        <span
          class="terminal-status"
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
          {{
            copyStatus === "copied"
              ? "Copied output"
              : copyStatus === "failed"
                ? "Copy failed"
                : ""
          }}
        </span>
        <AppButton icon="copy" variant="secondary" @click="copyTerminalOutput">
          Copy output
        </AppButton>
        <AppButton
          class="terminal-close-window"
          variant="secondary"
          @click="$emit('close')"
        >
          <span>{{ isWindowMode ? "Close window" : "Hide" }}</span>
          <kbd v-if="isWindowMode && closeShortcutLabel">
            {{ closeShortcutLabel }}
          </kbd>
        </AppButton>
        <AppButton
          variant="secondary"
          @click="$emit('restart', terminal.runId)"
        >
          Restart
        </AppButton>
        <AppButton
          class="terminal-stop"
          variant="danger"
          @click="$emit('stop', terminal.runId)"
        >
          {{ terminal.isRunning ? "Stop" : "Close" }}
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

.terminal-window-shell {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: 100vw;
  height: 100vh;
  min-height: 0;
  padding: 0 12px 12px;
  background: var(--terminal-panel);
  -webkit-app-region: drag;
}

.terminal-window-titlebar {
  display: grid;
  position: relative;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 40px;
  align-items: center;
  padding: 0 18px 0 0;
  -webkit-app-region: drag;
}

.terminal-window-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  -webkit-app-region: no-drag;
}

.terminal-window-control {
  width: 13px;
  min-width: 13px;
  height: 13px;
  min-height: 13px;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0;
  box-shadow: none;
}

.terminal-window-control.close {
  border-color: #df4d43;
  background: #ff5f57;
}

.terminal-window-control.minimize {
  border-color: #d59a23;
  background: #ffbd2e;
}

.terminal-window-control.maximize {
  border-color: #27a844;
  background: #28c840;
}

.terminal-window-control:hover:not(:disabled) {
  filter: brightness(0.94);
}

.terminal-window-control.close:hover:not(:disabled) {
  background: #ff5f57;
}

.terminal-window-control.minimize:hover:not(:disabled) {
  background: #ffbd2e;
}

.terminal-window-control.maximize:hover:not(:disabled) {
  background: #28c840;
}

.terminal-window-app-title {
  position: absolute;
  left: 50%;
  max-width: min(320px, calc(100vw - 180px));
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-size-base);
  font-weight: 800;
  text-align: center;
  text-overflow: ellipsis;
  transform: translateX(-50%);
  white-space: nowrap;
}

.terminal-window-header {
  display: flex;
  min-width: 0;
  min-height: 60px;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
  border-top: 1px solid color-mix(in srgb, #fff 58%, transparent);
  border-bottom: 1px solid
    color-mix(in srgb, var(--terminal-border) 54%, transparent);
  padding: 0 6px 10px;
  -webkit-app-region: drag;
}

.terminal-window-header div {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.terminal-window-header p,
.terminal-window-header h2 {
  margin: 0;
}

.terminal-window-header p {
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-window-header h2 {
  overflow: hidden;
  color: var(--terminal-title);
  font-size: var(--font-size-heading);
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-window-header code {
  overflow: hidden;
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-window {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 12px;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: var(--terminal-panel);
  color: var(--terminal-text);
  -webkit-user-select: none;
  user-select: none;
  -webkit-app-region: drag;
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

.terminal-status {
  flex: 0 0 auto;
  align-self: start;
  border-radius: 999px;
  padding: 3px 8px;
  background: color-mix(in srgb, var(--warning-soft) 74%, transparent);
  color: var(--warning-text);
  font-size: var(--font-size-compact);
  font-weight: 900;
  line-height: 1.2;
}

.terminal-window-header .terminal-status {
  margin-top: 1px;
}

.terminal-status.done {
  background: color-mix(in srgb, var(--success-soft) 74%, transparent);
  color: var(--success-text);
}

.terminal-status.failed {
  background: color-mix(in srgb, var(--danger-soft) 78%, transparent);
  color: var(--danger-text);
}

.terminal-status.stopped {
  background: color-mix(in srgb, var(--warning-soft) 78%, transparent);
  color: var(--warning-text);
}

.terminal-modal pre,
.terminal-window pre {
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
  -webkit-app-region: no-drag;
}

.terminal-modal-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  justify-content: flex-end;
  -webkit-app-region: no-drag;
}

.terminal-copy-status {
  min-width: 92px;
  color: var(--muted);
  font-size: var(--font-size-base);
  font-weight: 700;
  text-align: right;
}

.terminal-close-window {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.terminal-close-window kbd {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.terminal-stop {
  flex: 0 0 auto;
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

  .terminal-modal .terminal-modal-header,
  .terminal-modal .terminal-modal-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .terminal-window-shell {
    padding: 0 10px 10px;
  }

  .terminal-window-titlebar {
    min-height: 38px;
    padding: 0 14px 0 0;
  }

  .terminal-window-app-title {
    max-width: calc(100vw - 150px);
  }

  .terminal-window-header {
    min-height: 56px;
    padding: 0 4px 9px;
  }

  .terminal-window-header .terminal-status {
    display: none;
  }
}
</style>
