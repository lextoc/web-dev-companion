<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { parseDiffOutput } from "../output-formatting";
import type {
  GitStatusEntry,
  RepositoryDetails,
  RepositorySummary,
  ScriptTerminal,
  StatusFileDiff,
  StatusFileDiffType,
} from "../repositories";
import NpmScriptsPanel from "./NpmScriptsPanel.vue";

const props = defineProps<{
  selectedDetails: RepositoryDetails | null;
  selectedSummary?: RepositorySummary;
  isDetailLoading: boolean;
  statusActionLabel: string | null;
  pendingStatusActionKey: string | null;
  statusFeedbackMessage: string | null;
  commitClearToken: number;
  commitCelebrations: boolean;
  npmScripts: [string, string][];
  pinnedScriptNames: string[];
  scriptTerminalsByScript: Record<string, ScriptTerminal>;
}>();

const emit = defineEmits<{
  refresh: [];
  stageFiles: [request: { paths: string[]; actionKey: string }];
  unstageFiles: [request: { paths: string[]; actionKey: string }];
  commit: [message: string];
  commitDraftChange: [hasDraft: boolean];
  runScript: [scriptName: string];
  togglePinScript: [scriptName: string];
  stopScript: [scriptName: string];
  restartScript: [scriptName: string];
  openTerminal: [scriptName: string];
}>();

const commitMessage = ref("");
const confettiBursts = ref<Array<{ id: number }>>([]);
const activeDetailTab = ref<"git" | "scripts">("git");
const selectedStatusDiff = ref<StatusFileDiff | null>(null);
const statusDiffLoadingKey = ref<string | null>(null);
const statusDiffError = ref<string | null>(null);
const selectedStatusDiffLines = computed(() => parseDiffOutput(selectedStatusDiff.value?.content ?? ""));
let nextConfettiBurstId = 0;

const stagedPreview = computed(() => props.selectedDetails?.gitStatus.staged ?? []);

watch(
  () => props.commitClearToken,
  () => {
    commitMessage.value = "";
  },
);

watch(
  () => props.selectedDetails?.path,
  () => {
    activeDetailTab.value = "git";
  },
);

watch(commitMessage, (message) => {
  emit("commitDraftChange", Boolean(message.trim()));
});

function statusGroups(gitStatus: RepositoryDetails["gitStatus"]) {
  return [
    { key: "conflicted", label: "Conflicts", entries: gitStatus.conflicted },
    { key: "unstaged", label: "Unstaged", entries: gitStatus.unstaged },
    { key: "untracked", label: "Untracked", entries: gitStatus.untracked },
  ];
}

function visibleStatusGroups(gitStatus: RepositoryDetails["gitStatus"]) {
  return statusGroups(gitStatus).filter((group) => group.entries.length > 0);
}

function statusCode(entry: GitStatusEntry) {
  return `${entry.index}${entry.workingTree}`;
}

function statusEntryPaths(entries: GitStatusEntry[]) {
  return [...new Set(entries.map((entry) => entry.path))];
}

function statusCounts(gitStatus: RepositoryDetails["gitStatus"]) {
  return [
    { key: "staged", label: "Staged", count: gitStatus.staged.length },
    { key: "unstaged", label: "Unstaged", count: gitStatus.unstaged.length },
    { key: "untracked", label: "Untracked", count: gitStatus.untracked.length },
    { key: "conflicted", label: "Conflicts", count: gitStatus.conflicted.length },
  ];
}

function stagedFileCount(gitStatus: RepositoryDetails["gitStatus"]) {
  return gitStatus.staged.length;
}

function stagedFileLabel(gitStatus: RepositoryDetails["gitStatus"]) {
  const count = stagedFileCount(gitStatus);

  return count === 1 ? "1 staged file" : `${count} staged files`;
}

function isStagedGroup(groupKey: string) {
  return groupKey === "staged";
}

function statusActionLabelForGroup(groupKey: string) {
  return isStagedGroup(groupKey) ? "Unstage all" : "Stage all";
}

function statusActionLabelForEntry(groupKey: string) {
  return isStagedGroup(groupKey) ? "Unstage" : "Stage";
}

function statusActionKey(groupKey: string, entries: GitStatusEntry[]) {
  return `${isStagedGroup(groupKey) ? "unstage" : "stage"}:${statusEntryPaths(entries).join("\n")}`;
}

function statusDiffType(groupKey: string): StatusFileDiffType {
  if (groupKey === "staged" || groupKey === "untracked" || groupKey === "conflicted") {
    return groupKey;
  }

  return "unstaged";
}

function statusDiffKey(groupKey: string, entry: GitStatusEntry) {
  return `${groupKey}:${entry.path}`;
}

async function openStatusDiff(groupKey: string, entry: GitStatusEntry) {
  if (!props.selectedDetails || statusDiffLoadingKey.value) {
    return;
  }

  const loadingKey = statusDiffKey(groupKey, entry);
  statusDiffLoadingKey.value = loadingKey;
  statusDiffError.value = null;

  try {
    selectedStatusDiff.value = await window.repositories.diffFile({
      repoPath: props.selectedDetails.path,
      path: entry.path,
      diffType: statusDiffType(groupKey),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load file changes.";
    statusDiffError.value = message;
  } finally {
    if (statusDiffLoadingKey.value === loadingKey) {
      statusDiffLoadingKey.value = null;
    }
  }
}

function closeStatusDiff() {
  selectedStatusDiff.value = null;
  statusDiffError.value = null;
}

function isStatusActionPending(groupKey: string, entries: GitStatusEntry[]) {
  return props.pendingStatusActionKey === statusActionKey(groupKey, entries);
}

function emitStatusAction(groupKey: string, entries: GitStatusEntry[]) {
  const paths = statusEntryPaths(entries);
  const actionKey = statusActionKey(groupKey, entries);

  if (isStagedGroup(groupKey)) {
    emit("unstageFiles", { paths, actionKey });
    return;
  }

  emit("stageFiles", { paths, actionKey });
}

function commitDisabledReason(
  gitStatus: RepositoryDetails["gitStatus"],
  isDetailLoading: boolean,
  pendingStatusActionKey: string | null,
) {
  if (isDetailLoading) {
    return "Repository action is already running.";
  }

  if (pendingStatusActionKey && pendingStatusActionKey !== "commit") {
    return "Another status action is running.";
  }

  if (gitStatus.conflicted.length > 0) {
    return "Resolve conflicts before committing.";
  }

  if (gitStatus.staged.length === 0) {
    return "Stage at least one file before committing.";
  }

  if (!commitMessage.value.trim()) {
    return "Enter a commit message.";
  }

  return undefined;
}

function submitCommit(
  gitStatus: RepositoryDetails["gitStatus"],
  isDetailLoading: boolean,
  pendingStatusActionKey: string | null,
) {
  const message = commitMessage.value.trim();

  if (commitDisabledReason(gitStatus, isDetailLoading, pendingStatusActionKey) || !message) {
    return;
  }

  triggerCommitConfetti();
  emit("commit", message);
}

function triggerCommitConfetti() {
  if (!props.commitCelebrations) {
    return;
  }

  const id = nextConfettiBurstId++;
  confettiBursts.value = [...confettiBursts.value, { id }];

  window.setTimeout(() => {
    confettiBursts.value = confettiBursts.value.filter((burst) => burst.id !== id);
  }, 1200);
}

</script>

<template>
  <section class="detail-view">
    <div v-if="isDetailLoading && !selectedDetails" class="detail-skeleton" aria-label="Loading repository">
      <section v-for="index in 3" :key="index" class="detail-panel skeleton-card">
        <span></span>
        <span></span>
        <span></span>
      </section>
    </div>

    <template v-else-if="selectedDetails">
      <nav class="detail-tabs" role="tablist" aria-label="Repository detail sections">
        <button
          id="git-overview-tab"
          type="button"
          class="secondary"
          role="tab"
          :class="{ active: activeDetailTab === 'git' }"
          :aria-selected="activeDetailTab === 'git'"
          aria-controls="git-overview-panel"
          @click="activeDetailTab = 'git'"
        >
          Git overview
        </button>
        <button
          id="npm-scripts-tab"
          type="button"
          class="secondary"
          role="tab"
          :class="{ active: activeDetailTab === 'scripts' }"
          :aria-selected="activeDetailTab === 'scripts'"
          aria-controls="npm-scripts-panel"
          @click="activeDetailTab = 'scripts'"
        >
          <span>NPM scripts</span>
          <span class="tab-count">{{ npmScripts.length }}</span>
        </button>
      </nav>

      <div
        v-if="activeDetailTab === 'git'"
        id="git-overview-panel"
        class="detail-layout scripts-tab-layout"
        role="tabpanel"
        aria-labelledby="git-overview-tab"
      >
        <div class="git-main-grid">
          <div class="git-work-column">
            <section
              class="detail-panel commit-panel"
              :class="{
                ready: stagedFileCount(selectedDetails.gitStatus) > 0,
                celebration: commitCelebrations,
              }"
            >
              <form
                class="commit-form commit-form-wide"
                @submit.prevent="
                  submitCommit(selectedDetails.gitStatus, isDetailLoading, pendingStatusActionKey)
                "
              >
                <div class="commit-message-row">
                  <label for="commit-message">Message</label>
                  <textarea
                    id="commit-message"
                    v-model="commitMessage"
                    rows="3"
                    placeholder="Describe this change"
                    :disabled="pendingStatusActionKey === 'commit'"
                    @keydown.meta.enter.prevent="
                      submitCommit(selectedDetails.gitStatus, isDetailLoading, pendingStatusActionKey)
                    "
                  ></textarea>
                </div>

                <button
                  type="submit"
                  class="commit-submit"
                  :disabled="
                    Boolean(
                      commitDisabledReason(
                        selectedDetails.gitStatus,
                        isDetailLoading,
                        pendingStatusActionKey,
                      ),
                    )
                  "
                  :title="
                    commitDisabledReason(
                      selectedDetails.gitStatus,
                      isDetailLoading,
                      pendingStatusActionKey,
                    )
                  "
                >
                  {{ pendingStatusActionKey === "commit" ? "Committing..." : "Commit" }}
                </button>

                <div
                  v-for="burst in confettiBursts"
                  :key="burst.id"
                  class="commit-confetti"
                  aria-hidden="true"
                >
                  <span v-for="index in 18" :key="index"></span>
                </div>

                <div class="commit-queue">
                  <div class="commit-queue-heading">
                    <span>Staged queue</span>
                    <strong>{{ stagedFileLabel(selectedDetails.gitStatus) }}</strong>
                  </div>
                  <ul v-if="stagedPreview.length > 0" class="staged-preview">
                    <li v-for="entry in stagedPreview" :key="`staged-preview-${entry.path}`">
                      <code>{{ statusCode(entry) }}</code>
                      <button
                        type="button"
                        class="staged-preview-file"
                        :disabled="Boolean(statusDiffLoadingKey)"
                        :aria-busy="statusDiffLoadingKey === statusDiffKey('staged', entry)"
                        :title="entry.path"
                        @click="openStatusDiff('staged', entry)"
                      >
                        <span>{{ entry.path }}</span>
                        <small>
                          {{
                            statusDiffLoadingKey === statusDiffKey('staged', entry)
                              ? "Loading changes..."
                              : "View changes"
                          }}
                        </small>
                      </button>
                      <button
                        type="button"
                        class="secondary status-action staged-preview-action"
                        :class="{ pending: isStatusActionPending('staged', [entry]) }"
                        :disabled="Boolean(pendingStatusActionKey)"
                        @click="emitStatusAction('staged', [entry])"
                      >
                        {{
                          isStatusActionPending('staged', [entry])
                            ? "Unstaging..."
                            : "Unstage"
                        }}
                      </button>
                    </li>
                  </ul>
                  <p v-else>
                    Stage files from Changes before committing.
                  </p>
                </div>
              </form>

              <div class="commit-changes-section">
                <div class="panel-heading commit-changes-heading">
                  <div>
                    <h3>Changes</h3>
                    <span class="panel-subtitle">Stage, unstage, and inspect files</span>
                  </div>
                </div>
                <div class="git-status-card">
                  <div class="status-counts" aria-label="Working tree summary">
                    <div
                      v-for="item in statusCounts(selectedDetails.gitStatus)"
                      :key="item.key"
                      :class="[item.key, { active: item.count > 0 }]"
                    >
                      <strong>{{ item.count }}</strong>
                      <span>{{ item.label }}</span>
                    </div>
                  </div>

                  <p v-if="statusActionLabel" class="status-pending">
                    {{ statusActionLabel }}
                  </p>
                  <p v-else-if="statusFeedbackMessage" class="status-feedback">
                    {{ statusFeedbackMessage }}
                  </p>

                  <div v-if="selectedDetails.gitStatus.clean" class="clean-state">
                    Working tree clean.
                  </div>

                  <div v-else-if="visibleStatusGroups(selectedDetails.gitStatus).length > 0" class="git-status-groups">
                    <section
                      v-for="group in visibleStatusGroups(selectedDetails.gitStatus)"
                      :key="group.key"
                      class="git-status-group"
                      :class="group.key"
                    >
                      <div class="git-status-group-heading">
                        <div class="git-status-group-title">
                          <h4>{{ group.label }}</h4>
                          <span>{{ group.entries.length }}</span>
                        </div>
                        <button
                          v-if="group.entries.length > 0"
                          type="button"
                          class="secondary status-action"
                          :class="{ pending: isStatusActionPending(group.key, group.entries) }"
                          :disabled="Boolean(pendingStatusActionKey)"
                          @click="emitStatusAction(group.key, group.entries)"
                        >
                          {{
                            isStatusActionPending(group.key, group.entries)
                              ? `${statusActionLabelForGroup(group.key)}...`
                              : statusActionLabelForGroup(group.key)
                          }}
                        </button>
                      </div>

                      <ul v-if="group.entries.length > 0" class="git-status-list">
                        <li v-for="entry in group.entries" :key="`${group.key}-${entry.path}`">
                          <code class="status-code" :class="group.key">{{ statusCode(entry) }}</code>
                          <button
                            type="button"
                            class="status-file-button"
                            :disabled="Boolean(statusDiffLoadingKey)"
                            :aria-busy="statusDiffLoadingKey === statusDiffKey(group.key, entry)"
                            @click="openStatusDiff(group.key, entry)"
                          >
                            <strong>{{ entry.path }}</strong>
                            <small v-if="entry.originalPath">
                              from {{ entry.originalPath }}
                            </small>
                            <small>
                              {{
                                statusDiffLoadingKey === statusDiffKey(group.key, entry)
                                  ? "Loading changes..."
                                  : `${entry.label} · View changes`
                              }}
                            </small>
                          </button>
                          <button
                            type="button"
                            class="secondary status-action"
                            :class="{ pending: isStatusActionPending(group.key, [entry]) }"
                            :disabled="Boolean(pendingStatusActionKey)"
                            @click="emitStatusAction(group.key, [entry])"
                          >
                            {{
                              isStatusActionPending(group.key, [entry])
                                ? `${statusActionLabelForEntry(group.key)}...`
                                : statusActionLabelForEntry(group.key)
                            }}
                          </button>
                        </li>
                      </ul>
                    </section>
                  </div>
                  <div v-else class="clean-state">
                    No unstaged, untracked, or conflicted changes.
                  </div>
                </div>
              </div>
            </section>
          </div>

          <details class="detail-panel remotes-panel">
            <summary>
              <span>Remotes</span>
              <small>Show configured git remotes</small>
            </summary>
            <pre>{{ selectedDetails.remotes }}</pre>
          </details>
        </div>
      </div>

      <div
        v-else
        id="npm-scripts-panel"
        class="detail-layout scripts-tab-layout"
        role="tabpanel"
        aria-labelledby="npm-scripts-tab"
      >
        <NpmScriptsPanel
          :npm-scripts="npmScripts"
          :pinned-script-names="pinnedScriptNames"
          :script-terminals-by-script="scriptTerminalsByScript"
          @run="$emit('runScript', $event)"
          @toggle-pin="$emit('togglePinScript', $event)"
          @stop="$emit('stopScript', $event)"
          @restart="$emit('restartScript', $event)"
          @open="$emit('openTerminal', $event)"
        />
      </div>
    </template>

    <div v-else class="empty-state">
      <strong>{{ selectedSummary?.name ?? "Repository" }} could not be loaded.</strong>
      <span>Check whether the folder still exists and is available, then refresh.</span>
      <button type="button" class="secondary" :disabled="isDetailLoading" @click="$emit('refresh')">
        Retry
      </button>
    </div>

    <div
      v-if="selectedStatusDiff || statusDiffError"
      class="modal-backdrop status-diff-backdrop"
      role="presentation"
      @click.self="closeStatusDiff"
    >
      <section class="status-diff-modal" role="dialog" aria-modal="true" aria-labelledby="status-diff-title">
        <header class="status-diff-header">
          <div>
            <span>File changes</span>
            <h2 id="status-diff-title">
              {{ selectedStatusDiff?.path ?? "Could not load changes" }}
            </h2>
          </div>
          <button type="button" class="secondary" @click="closeStatusDiff">Close</button>
        </header>

        <p v-if="statusDiffError" class="status-diff-error">{{ statusDiffError }}</p>
        <pre v-else class="status-diff-output"><code><span
          v-for="line in selectedStatusDiffLines"
          :key="line.key"
          class="diff-line"
          :class="line.className"
        ><span class="diff-line-prefix">{{ line.prefix }}</span><span>{{ line.content }}</span></span></code></pre>
      </section>
    </div>
  </section>
</template>
