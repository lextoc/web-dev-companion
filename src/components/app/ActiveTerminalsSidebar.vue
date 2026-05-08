<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { plainTerminalText } from "../../output-formatting";
import type {
  GitCommandLogEntry,
  PinnedScript,
  ScriptTerminal,
} from "../../repositories";
import { AppButton } from "../ui";

interface TerminalGroup {
  repoPath: string;
  repoName: string;
  runningCount: number;
  doneCount: number;
  failedCount: number;
  stoppedCount: number;
  pinnedCount: number;
  entries: TerminalEntry[];
}

interface TerminalEntry {
  key: string;
  repoPath: string;
  repoName: string;
  scriptName: string;
  command: string;
  pinnedScript?: PinnedScript;
  terminal?: ScriptTerminal;
}

type TerminalEntryMap = Map<string, TerminalEntry>;
type TerminalGroupMap = Map<string, TerminalEntry[]>;

const props = defineProps<{
  terminals: ScriptTerminal[];
  pinnedScripts: PinnedScript[];
  gitCommandLog: GitCommandLogEntry[];
}>();

const gitCommandLogElement = ref<HTMLElement | null>(null);

defineEmits<{
  stop: [runId: string];
  restart: [runId: string];
  open: [runId: string];
  openRepositoryScripts: [repoPath: string];
  startPinned: [script: PinnedScript];
  unpinPinned: [script: PinnedScript];
}>();

const terminalEntriesByKey = computed<TerminalEntryMap>(() => {
  const entriesByKey = new Map<string, TerminalEntry>();

  for (const terminal of props.terminals) {
    const key = getTerminalKey(terminal.repoPath, terminal.scriptName);
    entriesByKey.set(key, {
      key,
      repoPath: terminal.repoPath,
      repoName: terminal.repoName,
      scriptName: terminal.scriptName,
      command: terminal.command,
      terminal,
    });
  }

  for (const pinnedScript of props.pinnedScripts) {
    const key = getTerminalKey(pinnedScript.repoPath, pinnedScript.scriptName);
    const existingEntry = entriesByKey.get(key);

    entriesByKey.set(key, {
      key,
      repoPath: pinnedScript.repoPath,
      repoName: pinnedScript.repoName,
      scriptName: pinnedScript.scriptName,
      command: existingEntry?.command ?? pinnedScript.command,
      terminal: existingEntry?.terminal,
      pinnedScript,
    });
  }

  return entriesByKey;
});

const terminalGroups = computed<TerminalGroup[]>(() => {
  const groups: TerminalGroupMap = new Map<string, TerminalEntry[]>();

  for (const entry of terminalEntriesByKey.value.values()) {
    const existingEntries = groups.get(entry.repoPath) ?? [];
    existingEntries.push(entry);
    groups.set(entry.repoPath, existingEntries);
  }

  return [...groups.entries()]
    .sort(sortEntriesByRepository)
    .map(([repoPath, entries]) => createGroup(repoPath, entries));
});

const pinnedIdleCount = computed(() => {
  const activeScriptKeys = new Set(
    props.terminals.map((terminal) =>
      getTerminalKey(terminal.repoPath, terminal.scriptName),
    ),
  );

  let count = 0;
  for (const pinnedScript of props.pinnedScripts) {
    if (
      !activeScriptKeys.has(
        getTerminalKey(pinnedScript.repoPath, pinnedScript.scriptName),
      )
    ) {
      count += 1;
    }
  }
  return count;
});

const sidebarScriptCount = computed(
  () => props.terminals.length + pinnedIdleCount.value,
);

function scrollGitCommandLogToBottom() {
  void nextTick(() => {
    window.requestAnimationFrame(() => {
      if (!gitCommandLogElement.value) {
        return;
      }

      gitCommandLogElement.value.scrollTop =
        gitCommandLogElement.value.scrollHeight;
    });
  });
}

watch(
  () => props.gitCommandLog.at(-1)?.id,
  () => {
    scrollGitCommandLogToBottom();
  },
  { flush: "post" },
);

onMounted(scrollGitCommandLogToBottom);

function createGroup(repoPath: string, entries: TerminalEntry[]) {
  const sortedEntries = [...entries].sort(compareTerminalEntries);
  const repoName = entries[0]?.repoName ?? repoPath;

  return {
    repoPath,
    repoName,
    runningCount: entries.filter((entry) => entry.terminal?.isRunning).length,
    doneCount: entries.filter(
      (entry) => entry.terminal && getTerminalStatus(entry.terminal) === "done",
    ).length,
    failedCount: entries.filter(
      (entry) => entry.terminal && getTerminalStatus(entry.terminal) === "failed",
    ).length,
    stoppedCount: entries.filter(
      (entry) => entry.terminal && getTerminalStatus(entry.terminal) === "stopped",
    ).length,
    pinnedCount: entries.filter((entry) => entry.pinnedScript).length,
    entries: sortedEntries,
  };
}

function getTerminalKey(repoPath: string, scriptName: string) {
  return `${repoPath}\n${scriptName}`;
}

function sortEntriesByRepository(
  [repoPathA, entriesA]: [string, TerminalEntry[]],
  [repoPathB, entriesB]: [string, TerminalEntry[]],
) {
  const repoNameA = entriesA[0]?.repoName ?? repoPathA;
  const repoNameB = entriesB[0]?.repoName ?? repoPathB;

  return repoNameA.localeCompare(repoNameB) || repoPathA.localeCompare(repoPathB);
}

function compareTerminalEntries(entryA: TerminalEntry, entryB: TerminalEntry) {
  return (
    Number(Boolean(entryB.pinnedScript)) - Number(Boolean(entryA.pinnedScript)) ||
    Number(Boolean(entryB.terminal?.isRunning)) -
      Number(Boolean(entryA.terminal?.isRunning)) ||
    Number(entryB.terminal ? getTerminalStatus(entryB.terminal) === "failed" : false) -
      Number(entryA.terminal ? getTerminalStatus(entryA.terminal) === "failed" : false) ||
    Number(Boolean(entryB.terminal)) - Number(Boolean(entryA.terminal)) ||
    entryA.scriptName.localeCompare(entryB.scriptName)
  );
}

function getTerminalStatus(terminal: ScriptTerminal) {
  if (terminal.isRunning) {
    return "running";
  }

  if (terminal.signal) {
    return "stopped";
  }

  if (terminal.exitCode !== null && terminal.exitCode !== undefined && terminal.exitCode !== 0) {
    return "failed";
  }

  return "done";
}

function getTerminalStatusLabel(terminal: ScriptTerminal) {
  const status = getTerminalStatus(terminal);

  if (status === "running") {
    return "Running";
  }

  if (status === "failed") {
    return "Failed";
  }

  if (status === "stopped") {
    return "Stopped";
  }

  return "Done";
}

function getTerminalPreview(terminal: ScriptTerminal) {
  const outputLines = plainTerminalText(terminal.output).split(/\r?\n/);

  for (let i = outputLines.length - 1; i >= 0; i -= 1) {
    const line = outputLines[i].trim();
    if (line) {
      return line;
    }
  }

  if (terminal.isRunning) {
    return "Waiting for output...";
  }

  return "No output captured.";
}

function formatCommandTime(startedAt: string) {
  return new Date(startedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
</script>

<template>
  <aside class="active-terminals" aria-label="Active terminal scripts">
    <div class="active-terminals-heading">
      <div class="active-terminals-title">
        <h2>Scripts</h2>
        <span>{{ sidebarScriptCount }}</span>
      </div>
    </div>

    <div v-if="terminalGroups.length" class="active-terminal-groups">
      <section
        v-for="group in terminalGroups"
        :key="group.repoPath"
        class="active-terminal-group"
      >
        <div class="active-terminal-group-heading">
          <button
            type="button"
            class="active-terminal-repo-link"
            :title="`Open ${group.repoName} scripts`"
            @click="$emit('openRepositoryScripts', group.repoPath)"
          >
            {{ group.repoName }}
          </button>
          <span>
            {{ group.runningCount }} running
            <template v-if="group.failedCount">
              &middot; {{ group.failedCount }} failed</template
            >
            <template v-if="group.stoppedCount">
              &middot; {{ group.stoppedCount }} stopped</template
            >
            <template v-if="group.doneCount">
              &middot; {{ group.doneCount }} done</template
            >
            <template v-if="group.pinnedCount">
              &middot; {{ group.pinnedCount }} pinned</template
            >
          </span>
        </div>
        <div class="active-terminal-list">
          <article
            v-for="entry in group.entries"
            :key="entry.key"
            class="active-terminal-item"
            :class="{ pinned: entry.pinnedScript && !entry.terminal }"
            :role="entry.terminal ? 'button' : undefined"
            :tabindex="entry.terminal ? 0 : undefined"
            :title="entry.terminal ? 'Open full terminal' : 'Pinned script'"
            @click="entry.terminal && $emit('open', entry.terminal.runId)"
            @keydown.enter="
              entry.terminal && $emit('open', entry.terminal.runId)
            "
            @keydown.space.prevent="
              entry.terminal && $emit('open', entry.terminal.runId)
            "
          >
            <div class="active-terminal-main">
              <div class="active-terminal-item-heading">
                <strong>{{ entry.scriptName }}</strong>
                <span
                  class="active-terminal-status"
                  :class="{
                    done: entry.terminal && getTerminalStatus(entry.terminal) === 'done',
                    failed: entry.terminal && getTerminalStatus(entry.terminal) === 'failed',
                    stopped: entry.terminal && getTerminalStatus(entry.terminal) === 'stopped',
                    pinned: !entry.terminal,
                  }"
                >
                  {{
                    entry.terminal
                      ? getTerminalStatusLabel(entry.terminal)
                      : "Pinned"
                  }}
                </span>
              </div>
              <code>{{ entry.command }}</code>
              <p :class="{ empty: !entry.terminal?.output.trim() }">
                {{
                  entry.terminal
                    ? getTerminalPreview(entry.terminal)
                    : "Ready to start from anywhere."
                }}
              </p>
            </div>
            <div class="active-terminal-actions">
              <AppButton
                v-if="entry.terminal || entry.pinnedScript"
                :icon="
                  entry.terminal
                    ? entry.terminal.isRunning
                      ? 'stop'
                      : 'close'
                    : 'play'
                "
                class="terminal-stop terminal-action-button"
                :variant="entry.terminal?.isRunning ? 'primary' : 'secondary'"
                :aria-label="
                  entry.terminal
                    ? `${entry.terminal.isRunning ? 'Stop' : 'Close'} ${entry.scriptName}`
                    : `Start ${entry.scriptName}`
                "
                :title="
                  entry.terminal
                    ? entry.terminal.isRunning
                      ? 'Stop script'
                      : 'Close terminal'
                    : 'Start script'
                "
                @click.stop="
                  entry.terminal
                    ? $emit('stop', entry.terminal.runId)
                    : entry.pinnedScript &&
                      $emit('startPinned', entry.pinnedScript)
                "
                @keydown.enter.stop
                @keydown.space.stop
              >
                {{
                  entry.terminal
                    ? entry.terminal.isRunning
                      ? "Stop"
                      : "Close"
                    : "Start"
                }}
              </AppButton>
              <AppButton
                v-if="entry.terminal"
                variant="secondary"
                size="icon"
                icon="restart"
                class="terminal-restart"
                :aria-label="`Restart ${entry.scriptName}`"
                title="Restart script"
                @click.stop="$emit('restart', entry.terminal.runId)"
                @keydown.enter.stop
                @keydown.space.stop
              >
                Restart
              </AppButton>
              <span
                v-else
                class="terminal-action-placeholder"
                aria-hidden="true"
              ></span>
              <AppButton
                v-if="entry.pinnedScript"
                variant="secondary"
                size="icon"
                icon="pin-off"
                class="terminal-pin"
                :aria-label="`Unpin ${entry.scriptName}`"
                title="Unpin script"
                @click.stop="$emit('unpinPinned', entry.pinnedScript)"
                @keydown.enter.stop
                @keydown.space.stop
              >
                Unpin
              </AppButton>
              <span
                v-else
                class="terminal-action-placeholder"
                aria-hidden="true"
              ></span>
            </div>
          </article>
        </div>
      </section>
    </div>

    <p v-else class="active-terminals-empty">No active or pinned scripts.</p>

    <section class="git-command-pane" aria-label="Git command history">
      <div class="git-command-pane-heading">
        <div>
          <h3>Terminal</h3>
          <span>Recent git commands this session</span>
        </div>
      </div>

      <div
        v-show="gitCommandLog.length"
        ref="gitCommandLogElement"
        class="git-command-log"
        role="log"
        aria-live="polite"
      >
        <article
          v-for="entry in gitCommandLog"
          :key="entry.id"
          class="git-command-entry"
          :class="{ failed: !entry.ok }"
        >
          <time :datetime="entry.startedAt">{{
            formatCommandTime(entry.startedAt)
          }}</time>
          <code>
            <span class="git-command-prompt" aria-hidden="true">$</span>
            <span class="git-command-text">{{ entry.command }}</span>
          </code>
        </article>
      </div>
      <p v-if="!gitCommandLog.length" class="git-command-empty">
        No git commands recorded yet.
      </p>
    </section>
  </aside>
</template>

<style scoped>
.active-terminals {
  position: relative;
  right: auto;
  z-index: 15;
  display: grid;
  flex: 0 0 var(--scripts-sidebar-width);
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0;
  width: var(--scripts-sidebar-width);
  height: auto;
  min-height: 0;
  max-height: none;
  align-content: start;
  overflow: hidden;
  border: 0;
  border-left: 1px solid color-mix(in srgb, var(--border-soft) 78%, transparent);
  border-radius: 0;
  margin-top: 0;
  padding: 0;
  background: color-mix(in srgb, var(--surface) 76%, var(--app-bg));
  box-shadow: none;
}

.active-terminals-heading {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  width: 100%;
  min-height: 62px;
  border-bottom: 0;
  padding: 20px 22px 8px;
  background: transparent;
}

.active-terminals-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}

.active-terminals-heading h2 {
  margin: 0;
  font-size: var(--font-size-title);
  white-space: nowrap;
}

.active-terminals-title span {
  display: grid;
  min-width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-subtle) 84%, transparent);
  color: var(--muted-strong);
  font-size: var(--font-size-base);
  font-weight: 900;
}

.active-terminal-groups {
  display: grid;
  align-content: start;
  gap: 20px;
  min-height: 0;
  overflow: auto;
  padding: 14px 20px 22px;
}

.active-terminal-group {
  display: grid;
  gap: 8px;
}

.active-terminal-group-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 7px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-soft) 62%, transparent);
}

.active-terminal-repo-link {
  min-width: 0;
  overflow: hidden;
  border: 0;
  padding: 0;
  background: transparent;
  color: color-mix(in srgb, var(--muted-strong) 86%, var(--text));
  cursor: pointer;
  font-size: var(--font-size-base);
  font-weight: 900;
  line-height: 1.2;
  text-align: left;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.active-terminal-repo-link:hover {
  color: var(--accent-strong);
}

.active-terminal-repo-link:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 3px;
}

.active-terminal-group-heading span {
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--muted) 88%, transparent);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.active-terminal-list {
  display: grid;
  gap: 0;
  border-top: 0;
}

.active-terminal-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  border: 0;
  border-radius: 7px;
  padding: 10px 8px;
  background: transparent;
  cursor: pointer;
}

.active-terminal-item + .active-terminal-item {
  border-top: 1px solid color-mix(in srgb, var(--border-soft) 54%, transparent);
  border-radius: 0;
}

.active-terminal-item.pinned {
  box-shadow: none;
  background: transparent;
  cursor: default;
}

.active-terminal-item:hover {
  box-shadow: none;
  background: color-mix(in srgb, var(--surface-hover) 64%, transparent);
}

.active-terminal-item:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}

.active-terminal-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.active-terminal-item-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.active-terminal-item strong,
.active-terminal-item code,
.active-terminal-item p {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.active-terminal-item strong {
  display: block;
  color: var(--text);
  font-size: var(--font-size-base);
  line-height: 1.25;
}

.active-terminal-item code {
  display: block;
  color: color-mix(in srgb, var(--muted) 92%, var(--text));
  font-size: var(--font-size-compact);
}

.active-terminal-item p {
  margin: 0;
  border-left: 0;
  padding-left: 0;
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
}

.active-terminal-item p.empty {
  color: var(--muted);
}

.active-terminal-status {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 2px 7px;
  background: color-mix(in srgb, var(--warning-soft) 74%, transparent);
  color: var(--warning-text);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.active-terminal-status.done {
  background: color-mix(in srgb, var(--success-soft) 74%, transparent);
  color: var(--success-text);
}

.active-terminal-status.failed {
  background: color-mix(in srgb, var(--danger-soft) 78%, transparent);
  color: var(--danger-text);
}

.active-terminal-status.stopped {
  background: color-mix(in srgb, var(--warning-soft) 78%, transparent);
  color: var(--warning-text);
}

.active-terminal-status.pinned {
  background: color-mix(in srgb, var(--surface-subtle) 74%, transparent);
  color: var(--muted-strong);
}

.active-terminal-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
  width: 154px;
}

.active-terminal-item .terminal-stop,
.active-terminal-item .terminal-restart {
  min-height: 34px;
  padding: 0 11px;
}

.active-terminal-item .terminal-pin {
  min-height: 34px;
  padding: 0;
}

.active-terminal-item .subtle-icon-button {
  width: 34px;
  min-height: 36px;
  padding: 0;
}

.active-terminal-item .terminal-action-button {
  min-width: 72px;
}

.terminal-pin.active {
  border-color: color-mix(in srgb, var(--success-text) 44%, transparent);
  background: var(--success-soft);
  color: var(--success-text);
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

.terminal-action-placeholder {
  display: none;
  width: 34px;
  min-height: 36px;
  visibility: hidden;
}

.terminal-stop.secondary {
  border-color: var(--border-control);
  background: var(--surface);
  color: var(--text);
}

.terminal-stop.secondary:hover:not(:disabled) {
  border-color: var(--border-control);
  background: var(--surface-subtle);
  color: var(--text);
}

.active-terminals-empty {
  margin: 0;
  padding: 16px;
  color: var(--muted);
  font-size: var(--font-size-heading);
}

.git-command-pane {
  --git-command-border: #2a3946;
  --git-command-muted: #95a3ad;
  --git-command-panel: #0c1116;
  --git-command-surface: #0e151c;
  --git-command-text: #d4dee3;
  --git-command-title: #eaf2f4;
  display: grid;
  min-height: 0;
  max-height: 20vh;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 5px;
  overflow: hidden;
  border-top: 1px solid color-mix(in srgb, var(--git-command-border) 78%, transparent);
  padding: 8px 16px 10px;
  background: var(--git-command-panel);
}

.git-command-pane-heading {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.git-command-pane-heading > div {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
}

.git-command-pane-heading h3 {
  margin: 0;
  color: var(--git-command-title);
  font-size: var(--font-size-base);
  line-height: 1.2;
}

.git-command-pane-heading span {
  display: block;
  color: var(--git-command-muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
  line-height: 1.2;
}

.git-command-log {
  display: grid;
  align-content: start;
  gap: 5px;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

.git-command-entry {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: 7px;
  border-left: 2px solid var(--success-text);
  border-radius: 4px;
  padding: 3px 6px 3px 7px;
  background: color-mix(in srgb, var(--git-command-surface) 40%, transparent);
}

.git-command-entry:nth-child(even) {
  background: color-mix(in srgb, var(--git-command-surface) 72%, transparent);
}

.git-command-entry.failed {
  border-left-color: var(--danger-text);
}

.git-command-entry time {
  color: var(--git-command-muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
  line-height: 1.2;
  white-space: nowrap;
}

.git-command-entry code {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1ch;
  align-items: baseline;
  min-width: 0;
  color: var(--git-command-text);
  font-size: var(--font-size-compact);
  line-height: 1.25;
}

.git-command-prompt {
  white-space: nowrap;
}

.git-command-text {
  overflow-wrap: anywhere;
  white-space: normal;
}

.git-command-entry p,
.git-command-empty {
  margin: 0;
  color: var(--danger-text);
  font-size: var(--font-size-compact);
  font-weight: 800;
}

.git-command-empty {
  color: var(--git-command-muted);
}

.active-terminals {
  border: 0;
  border-left: 1px solid color-mix(in srgb, var(--border-soft) 78%, transparent);
  background: color-mix(in srgb, var(--surface) 80%, var(--app-bg));
  box-shadow: none;
}

.active-terminals-heading,
.active-terminal-list,
.active-terminal-item {
  border: 0;
  box-shadow: none;
}

.active-terminals-heading,
.active-terminal-item {
  background: transparent;
}

.active-terminal-item.pinned,
.active-terminal-item:hover {
  border-color: transparent;
  box-shadow: none;
}

.active-terminal-item:hover {
  background: color-mix(in srgb, var(--surface-hover) 68%, transparent);
}

.active-terminal-item + .active-terminal-item {
  border-top: 1px solid color-mix(in srgb, var(--border-soft) 54%, transparent);
}

.active-terminal-item p {
  border-left: 0;
  padding-left: 0;
}

.active-terminal-status {
  height: 22px;
  padding-top: 0;
  padding-bottom: 0;
  font-size: 0.72rem;
  font-weight: 720;
  line-height: 22px;
  vertical-align: middle;
}

@media (max-width: 1180px) {
  .active-terminals {
    position: static;
    right: auto;
    z-index: auto;
    width: auto;
    height: auto;
    max-height: none;
    grid-template-rows: auto;
    overflow: visible;
    border-left: 0;
    border-radius: 8px;
    margin-top: 0;
  }
}

@media (max-width: 760px) {
  .active-terminals {
    order: -1;
  }
}
</style>
