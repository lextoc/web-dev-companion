<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { parseDiffOutput } from "../output-formatting";
import type {
  CommitChangedFile,
  CommitDetails,
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
const activeDetailTab = ref<"git" | "log" | "scripts">("git");
const selectedStatusDiff = ref<StatusFileDiff | null>(null);
const statusDiffLoadingKey = ref<string | null>(null);
const statusDiffError = ref<string | null>(null);
const selectedCommitDetails = ref<CommitDetails | null>(null);
const commitDetailsLoadingHash = ref<string | null>(null);
const commitDetailsError = ref<string | null>(null);
const selectedStatusDiffLines = computed(() => parseDiffOutput(selectedStatusDiff.value?.content ?? ""));
const selectedCommitDiffLines = computed(() => parseDiffOutput(selectedCommitDetails.value?.diff ?? ""));
let nextConfettiBurstId = 0;
let nextCommitDetailsRequestId = 0;
let activeCommitDetailsRequestId = 0;
const logDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

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
    activeCommitDetailsRequestId = ++nextCommitDetailsRequestId;
    activeDetailTab.value = "git";
    selectedCommitDetails.value = null;
    commitDetailsLoadingHash.value = null;
    commitDetailsError.value = null;
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

function formatLogDate(dateTime: string) {
  const date = new Date(dateTime);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return logDateFormatter.format(date);
}

function fullLogDate(dateTime: string) {
  const date = new Date(dateTime);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString();
}

function isSelectedCommit(hash: string) {
  return (
    commitDetailsLoadingHash.value === hash ||
    selectedCommitDetails.value?.hash === hash ||
    selectedCommitDetails.value?.fullHash === hash
  );
}

function fileChangeSummary(file: CommitChangedFile) {
  const additions = file.additions === undefined ? "" : `+${file.additions}`;
  const deletions = file.deletions === undefined ? "" : `-${file.deletions}`;

  return [additions, deletions].filter(Boolean).join(" ");
}

async function openCommitDetails(entry: RepositoryDetails["gitLog"][number]) {
  if (!props.selectedDetails || commitDetailsLoadingHash.value === entry.hash) {
    return;
  }

  const repoPath = props.selectedDetails.path;
  const requestId = ++nextCommitDetailsRequestId;
  activeCommitDetailsRequestId = requestId;
  selectedCommitDetails.value = null;
  commitDetailsLoadingHash.value = entry.hash;
  commitDetailsError.value = null;

  try {
    const details = await window.repositories.commitDetails({
      repoPath,
      hash: entry.hash,
    });

    if (activeCommitDetailsRequestId === requestId && props.selectedDetails?.path === repoPath) {
      selectedCommitDetails.value = details;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load commit details.";
    if (activeCommitDetailsRequestId === requestId) {
      commitDetailsError.value = message;
    }
  } finally {
    if (activeCommitDetailsRequestId === requestId && commitDetailsLoadingHash.value === entry.hash) {
      commitDetailsLoadingHash.value = null;
    }
  }
}

function closeCommitDetails() {
  activeCommitDetailsRequestId = ++nextCommitDetailsRequestId;
  selectedCommitDetails.value = null;
  commitDetailsLoadingHash.value = null;
  commitDetailsError.value = null;
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
          id="git-log-tab"
          type="button"
          class="secondary"
          role="tab"
          :class="{ active: activeDetailTab === 'log' }"
          :aria-selected="activeDetailTab === 'log'"
          aria-controls="git-log-panel"
          @click="activeDetailTab = 'log'"
        >
          <span>Git log</span>
          <span class="tab-count">{{ selectedDetails.gitLog.length }}</span>
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
              </form>

              <div class="commit-changes-section">
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
                      Stage files below before committing.
                    </p>
                  </div>

                  <p v-if="statusActionLabel" class="status-pending">
                    {{ statusActionLabel }}
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
                          <span>
                            {{
                              isStatusActionPending(group.key, group.entries)
                                ? `${statusActionLabelForGroup(group.key)}...`
                                : statusActionLabelForGroup(group.key)
                            }}
                          </span>
                          <kbd v-if="!isStagedGroup(group.key)">⌘A</kbd>
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
        v-else-if="activeDetailTab === 'log'"
        id="git-log-panel"
        class="detail-layout scripts-tab-layout"
        role="tabpanel"
        aria-labelledby="git-log-tab"
      >
        <section class="detail-panel git-log-panel">
          <div v-if="selectedDetails.gitLog.length > 0" class="git-log-table-wrap">
            <table class="git-log-table">
              <thead>
                <tr>
                  <th scope="col">Commit</th>
                  <th scope="col">Message</th>
                  <th scope="col">Author</th>
                  <th scope="col">Time</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="entry in selectedDetails.gitLog"
                  :key="entry.hash"
                  :class="{ active: isSelectedCommit(entry.hash) }"
                  tabindex="0"
                  role="button"
                  :aria-busy="commitDetailsLoadingHash === entry.hash"
                  :aria-label="`View details for commit ${entry.hash}: ${entry.message}`"
                  :title="`View details for ${entry.hash}`"
                  @click="openCommitDetails(entry)"
                  @keydown.enter.prevent="openCommitDetails(entry)"
                  @keydown.space.prevent="openCommitDetails(entry)"
                >
                  <td>
                    <code>{{ entry.hash }}</code>
                    <small v-if="commitDetailsLoadingHash === entry.hash">Loading...</small>
                  </td>
                  <td>
                    <strong>{{ entry.message }}</strong>
                  </td>
                  <td>
                    <span :title="entry.authorEmail">{{ entry.authorName }}</span>
                  </td>
                  <td>
                    <time :datetime="entry.dateTime" :title="fullLogDate(entry.dateTime)">
                      {{ formatLogDate(entry.dateTime) }}
                    </time>
                    <small>{{ entry.time }}</small>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="clean-state">
            No commits found.
          </div>
        </section>
      </div>

      <div
        v-else-if="activeDetailTab === 'scripts'"
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
      v-if="selectedCommitDetails || commitDetailsLoadingHash || commitDetailsError"
      class="modal-backdrop commit-detail-backdrop"
      role="presentation"
      @click.self="closeCommitDetails"
    >
      <section
        class="commit-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="commit-detail-title"
        aria-live="polite"
      >
        <header class="commit-detail-header">
          <div class="commit-detail-title-row">
            <div>
              <span>Commit details</span>
              <h2 id="commit-detail-title">
                {{
                  commitDetailsError
                    ? "Could not load commit details"
                    : selectedCommitDetails?.message ?? "Loading commit details..."
                }}
              </h2>
            </div>
            <button type="button" class="secondary" @click="closeCommitDetails">Close</button>
          </div>
          <code v-if="selectedCommitDetails" :title="selectedCommitDetails.fullHash">
            {{ selectedCommitDetails.fullHash }}
          </code>
        </header>

        <div v-if="commitDetailsError" class="commit-detail-empty error">
          {{ commitDetailsError }}
        </div>

        <div
          v-else-if="commitDetailsLoadingHash && !selectedCommitDetails"
          class="commit-detail-empty"
        >
          Loading commit details...
        </div>

        <template v-else-if="selectedCommitDetails">
          <div class="commit-detail-scroll">
            <p v-if="selectedCommitDetails.body" class="commit-detail-body">
              {{ selectedCommitDetails.body }}
            </p>

            <dl class="commit-detail-meta">
              <div>
                <dt>Author</dt>
                <dd>
                  <span>{{ selectedCommitDetails.authorName }}</span>
                  <small>{{ selectedCommitDetails.authorEmail }}</small>
                </dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>
                  <time
                    :datetime="selectedCommitDetails.dateTime"
                    :title="fullLogDate(selectedCommitDetails.dateTime)"
                  >
                    {{ formatLogDate(selectedCommitDetails.dateTime) }}
                  </time>
                  <small>{{ selectedCommitDetails.time }}</small>
                </dd>
              </div>
              <div>
                <dt>Files</dt>
                <dd>
                  <span>{{ selectedCommitDetails.files.length }}</span>
                  <small>changed</small>
                </dd>
              </div>
            </dl>

            <div class="commit-detail-content">
              <section class="commit-files-section">
                <div class="commit-detail-section-heading">
                  <h4>Changed files</h4>
                  <span>{{ selectedCommitDetails.files.length }}</span>
                </div>
                <ul v-if="selectedCommitDetails.files.length > 0" class="commit-file-list">
                  <li v-for="file in selectedCommitDetails.files" :key="`${file.status}-${file.path}`">
                    <span class="commit-file-status">{{ file.status }}</span>
                    <span class="commit-file-path">
                      <strong>{{ file.path }}</strong>
                      <small v-if="file.originalPath">from {{ file.originalPath }}</small>
                    </span>
                    <code v-if="fileChangeSummary(file)">{{ fileChangeSummary(file) }}</code>
                  </li>
                </ul>
                <p v-else class="commit-detail-empty compact">
                  No changed files found for this commit.
                </p>
              </section>

              <section class="commit-diff-section">
                <div class="commit-detail-section-heading">
                  <h4>Patch</h4>
                </div>
                <pre class="status-diff-output commit-diff-output"><code><span
                  v-for="line in selectedCommitDiffLines"
                  :key="line.key"
                  class="diff-line"
                  :class="line.className"
                ><span class="diff-line-prefix">{{ line.prefix }}</span><span>{{ line.content }}</span></span></code></pre>
              </section>
            </div>
          </div>
        </template>
      </section>
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
