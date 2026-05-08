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
