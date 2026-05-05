<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { RepositoryActivityInput, RepositoryTimelineItem } from "../activity-timeline";
import { parseDiffOutput } from "../output-formatting";
import type {
  GitStatusEntry,
  RepositoryDetails,
  RepositorySummary,
  ScriptTerminal,
  StatusFileDiff,
  StatusFileDiffType,
} from "../repositories";
import AppIcon from "./AppIcon.vue";
import NpmScriptsPanel from "./NpmScriptsPanel.vue";

const props = defineProps<{
  selectedDetails: RepositoryDetails | null;
  selectedSummary?: RepositorySummary;
  isDetailLoading: boolean;
  autoRefreshLabel: string;
  autoRefreshProgress: number;
  syncingBranchName: string | null;
  deletingBranchName: string | null;
  statusActionLabel: string | null;
  pendingStatusActionKey: string | null;
  statusFeedbackMessage: string | null;
  branchFeedbackMessages: Record<string, string>;
  commitClearToken: number;
  npmScripts: [string, string][];
  pinnedScriptNames: string[];
  scriptTerminalsByScript: Record<string, ScriptTerminal>;
  activityTimeline: RepositoryTimelineItem[];
}>();

const emit = defineEmits<{
  back: [];
  refresh: [];
  deleteBranch: [branchName: string];
  syncBranch: [branchName: string];
  stageFiles: [request: { paths: string[]; actionKey: string }];
  unstageFiles: [request: { paths: string[]; actionKey: string }];
  commit: [message: string];
  commitDraftChange: [hasDraft: boolean];
  runScript: [scriptName: string];
  togglePinScript: [scriptName: string];
  stopScript: [scriptName: string];
  restartScript: [scriptName: string];
  openTerminal: [scriptName: string];
  copyPath: [repoPath: string];
  openInEditor: [repoPath: string];
  openInFileManager: [repoPath: string];
  openInTerminal: [repoPath: string];
  recordActivity: [activity: Omit<RepositoryActivityInput, "repoPath">];
}>();

const commitMessage = ref("");
const timelineLimit = ref(20);
const branchFilter = ref("all");
const activeDetailTab = ref<"git" | "scripts">("git");
const selectedStatusDiff = ref<StatusFileDiff | null>(null);
const statusDiffLoadingKey = ref<string | null>(null);
const statusDiffError = ref<string | null>(null);
const selectedStatusDiffLines = computed(() => parseDiffOutput(selectedStatusDiff.value?.content ?? ""));

const branchFilters = [
  { key: "all", label: "All" },
  { key: "behind", label: "Behind" },
  { key: "ahead", label: "Ahead" },
  { key: "no-upstream", label: "No upstream" },
  { key: "in-sync", label: "In sync" },
];

const visibleActivityTimeline = computed(() => props.activityTimeline.slice(0, timelineLimit.value));

const sortedBranches = computed(() => {
  const branches = props.selectedDetails?.gitBranches ?? [];

  return [...branches].sort((branchA, branchB) => {
    if (branchA.current !== branchB.current) {
      return branchA.current ? -1 : 1;
    }

    return branchA.name.localeCompare(branchB.name);
  });
});

const filteredBranches = computed(() =>
  sortedBranches.value.filter((branch) => {
    if (branchFilter.value === "behind") {
      return branch.behind > 0;
    }

    if (branchFilter.value === "ahead") {
      return branch.ahead > 0;
    }

    if (branchFilter.value === "no-upstream") {
      return !branch.upstream;
    }

    if (branchFilter.value === "in-sync") {
      return branch.inSyncWithRemote;
    }

    return true;
  }),
);

const stagedPreview = computed(() => props.selectedDetails?.gitStatus.staged.slice(0, 4) ?? []);
const hiddenStagedFileCount = computed(() =>
  Math.max(0, (props.selectedDetails?.gitStatus.staged.length ?? 0) - stagedPreview.value.length),
);

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
    { key: "staged", label: "Staged", entries: gitStatus.staged },
    { key: "unstaged", label: "Unstaged", entries: gitStatus.unstaged },
    { key: "untracked", label: "Untracked", entries: gitStatus.untracked },
  ];
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

function hasStageableChanges(gitStatus: RepositoryDetails["gitStatus"]) {
  return gitStatus.unstaged.length > 0 || gitStatus.untracked.length > 0;
}

function commitSummaryLabel(gitStatus: RepositoryDetails["gitStatus"]) {
  if (stagedFileCount(gitStatus) > 0) {
    return "Ready to commit";
  }

  if (gitStatus.conflicted.length > 0) {
    return "Resolve conflicts";
  }

  if (hasStageableChanges(gitStatus)) {
    return "Stage files first";
  }

  return "Working tree clean";
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
    emit("recordActivity", {
      kind: "error",
      title: `Could not load changes for ${entry.path}`,
      description: message,
      tone: "error",
    });
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

  emit("commit", message);
}

function copyCommitHash(hash: string) {
  void navigator.clipboard?.writeText(hash);
}

function timelineKindLabel(kind: RepositoryTimelineItem["kind"]) {
  if (kind === "app-commit") {
    return "App commit";
  }

  if (kind === "branch-sync") {
    return "Branch sync";
  }

  if (kind === "git-commit") {
    return "Git commit";
  }

  return kind.slice(0, 1).toUpperCase() + kind.slice(1);
}

function branchSyncLabel(branch: RepositoryDetails["gitBranches"][number]) {
  if (!branch.upstream) {
    return "No upstream";
  }

  if (branch.inSyncWithRemote) {
    return "In sync";
  }

  if (branch.remoteGone) {
    return "Remote gone";
  }

  if (branch.ahead > 0 && branch.behind > 0) {
    return `${branch.ahead} ahead, ${branch.behind} behind`;
  }

  if (branch.ahead > 0) {
    return `${branch.ahead} ahead`;
  }

  return `${branch.behind} behind`;
}

function hasStagedOrUnstagedChanges(gitStatus: RepositoryDetails["gitStatus"]) {
  return (
    gitStatus.staged.length > 0 ||
    gitStatus.unstaged.length > 0 ||
    gitStatus.conflicted.length > 0
  );
}

function branchSyncDisabledReason(
  branch: RepositoryDetails["gitBranches"][number],
  gitStatus: RepositoryDetails["gitStatus"],
) {
  if (hasStagedOrUnstagedChanges(gitStatus)) {
    return "Commit, stash, or discard staged and unstaged changes before syncing.";
  }

  if (!branch.upstream) {
    return "No upstream remote branch is configured.";
  }

  if (branch.remoteGone) {
    return "Upstream remote branch is gone.";
  }

  if (branch.ahead > 0 && branch.behind > 0) {
    return "Branch has both local and remote commits. Resolve it manually before syncing.";
  }

  return undefined;
}

function isSyncingBranch(branchName: string, syncingBranchName: string | null) {
  return syncingBranchName === branchName;
}

function isDeletingBranch(branchName: string, deletingBranchName: string | null) {
  return deletingBranchName === branchName;
}

function branchSyncTitle(
  branch: RepositoryDetails["gitBranches"][number],
  gitStatus: RepositoryDetails["gitStatus"],
  syncingBranchName: string | null,
) {
  if (isSyncingBranch(branch.name, syncingBranchName)) {
    return `Syncing ${branch.name}`;
  }

  return branchSyncDisabledReason(branch, gitStatus) ?? branchSyncActionTitle(branch);
}

function branchSyncActionLabel(branch: RepositoryDetails["gitBranches"][number]) {
  if (branch.ahead > 0 && branch.behind === 0) {
    return "Push";
  }

  if (branch.behind > 0 && branch.ahead === 0) {
    return "Pull";
  }

  return "Sync";
}

function branchSyncActionTitle(branch: RepositoryDetails["gitBranches"][number]) {
  if (branch.ahead > 0 && branch.behind === 0) {
    return "Push local commits to the upstream branch";
  }

  if (branch.behind > 0 && branch.ahead === 0) {
    return "Fast-forward the local branch from upstream";
  }

  return "Sync branch with upstream";
}

function branchSafetyNotes(
  branch: RepositoryDetails["gitBranches"][number],
  gitStatus: RepositoryDetails["gitStatus"],
) {
  const notes = [];
  const syncReason = branchSyncDisabledReason(branch, gitStatus);

  if (syncReason && !branch.inSyncWithRemote) {
    notes.push(syncReason);
  }

  if (!branch.canDelete && branch.deleteReason) {
    notes.push(branch.deleteReason);
  }

  return [...new Set(notes)];
}
</script>

<template>
  <section class="detail-view">
    <div class="detail-command-bar">
      <nav class="detail-nav" aria-label="Repository detail navigation">
        <button type="button" class="secondary detail-back-button" @click="$emit('back')">
          <AppIcon name="arrow-left" class="button-icon" />
          <span>Back</span>
        </button>

        <div v-if="selectedDetails" class="detail-context-pills" aria-label="Repository state">
          <span class="branch-pill">{{ selectedDetails.branch }}</span>
          <span class="status-pill" :class="{ dirty: selectedDetails.dirty }">
            {{ selectedDetails.dirty ? "Changes" : "Clean" }}
          </span>
        </div>
      </nav>

      <div v-if="selectedDetails" class="detail-quick-actions" aria-label="Repository quick actions">
        <button type="button" class="secondary" @click="$emit('openInFileManager', selectedDetails.path)">
          Files
        </button>
        <button type="button" class="secondary" @click="$emit('openInEditor', selectedDetails.path)">
          Editor
        </button>
        <button type="button" class="secondary" @click="$emit('openInTerminal', selectedDetails.path)">
          Terminal
        </button>
        <button type="button" class="secondary" @click="$emit('copyPath', selectedDetails.path)">
          Copy path
        </button>
      </div>

      <div class="detail-refresh-area">
        <button
          type="button"
          class="secondary refresh-button"
          :disabled="isDetailLoading"
          :title="autoRefreshLabel"
          @click="$emit('refresh')"
        >
          <span class="refresh-button-label">Refresh</span>
          <span class="refresh-progress" aria-hidden="true">
            <span
              class="refresh-progress-fill"
              :style="{ width: `${autoRefreshProgress}%` }"
            ></span>
          </span>
        </button>
      </div>
    </div>

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
        class="detail-layout git-detail-layout"
        role="tabpanel"
        aria-labelledby="git-overview-tab"
      >
        <aside class="detail-panel git-overview-panel git-log-panel git-log-sidebar">
          <div class="panel-heading git-log-heading">
            <div>
              <h3>Timeline</h3>
              <span>Commits and local app activity</span>
            </div>
            <div class="segmented-control" aria-label="Timeline length">
              <button
                v-for="limit in [20, 50]"
                :key="limit"
                type="button"
                class="secondary"
                :class="{ active: timelineLimit === limit }"
                @click="timelineLimit = limit"
              >
                {{ limit }}
              </button>
            </div>
          </div>
          <ol
            v-if="visibleActivityTimeline.length > 0"
            class="git-log-rail repo-timeline"
            aria-label="Repository activity timeline"
          >
            <li
              v-for="entry in visibleActivityTimeline"
              :key="entry.id"
              :class="[entry.kind, entry.tone]"
            >
              <div class="timeline-entry-heading">
                <span>{{ timelineKindLabel(entry.kind) }}</span>
                <time :datetime="entry.occurredAt" :title="entry.occurredAt">
                  {{ entry.timeLabel }}
                </time>
              </div>
              <p :title="entry.title">{{ entry.title }}</p>
              <small v-if="entry.description" :title="entry.description">
                {{ entry.description }}
              </small>
              <div v-if="entry.hash || entry.meta" class="git-log-rail-meta">
                <button
                  v-if="entry.hash"
                  type="button"
                  class="secondary git-hash-chip"
                  title="Copy commit hash"
                  @click="copyCommitHash(entry.hash)"
                >
                  {{ entry.hash }}
                </button>
                <span v-else class="timeline-meta">{{ entry.meta }}</span>
              </div>
            </li>
          </ol>
          <div v-else class="empty-state compact-empty">
            No repository activity available yet.
          </div>
        </aside>

        <div class="git-main-grid">
          <section
            class="detail-panel commit-panel"
            :class="{ ready: stagedFileCount(selectedDetails.gitStatus) > 0 }"
          >
            <form
              class="commit-form commit-form-wide"
              @submit.prevent="
                submitCommit(selectedDetails.gitStatus, isDetailLoading, pendingStatusActionKey)
              "
            >
              <div class="commit-form-heading">
                <div>
                  <span>Commit</span>
                  <strong>
                    {{ commitSummaryLabel(selectedDetails.gitStatus) }}
                  </strong>
                </div>
                <div class="commit-heading-actions">
                  <span
                    v-if="stagedFileCount(selectedDetails.gitStatus) > 0"
                    class="commit-count-chip"
                  >
                    {{ stagedFileLabel(selectedDetails.gitStatus) }}
                  </span>
                  <button
                    v-if="stagedFileCount(selectedDetails.gitStatus) > 0"
                    type="button"
                    class="secondary status-action"
                    :disabled="Boolean(pendingStatusActionKey)"
                    @click="emitStatusAction('staged', selectedDetails.gitStatus.staged)"
                  >
                    {{
                      isStatusActionPending('staged', selectedDetails.gitStatus.staged)
                        ? 'Unstaging...'
                        : 'Unstage all'
                    }}
                  </button>
                </div>
              </div>

              <div class="commit-message-row">
                <label for="commit-message">Message</label>
                <textarea
                  id="commit-message"
                  v-model="commitMessage"
                  rows="3"
                  placeholder="Describe this change"
                  :disabled="pendingStatusActionKey === 'commit'"
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

              <ul v-if="stagedPreview.length > 0" class="staged-preview">
                <li v-for="entry in stagedPreview" :key="`staged-preview-${entry.path}`">
                  <code>{{ statusCode(entry) }}</code>
                  <span :title="entry.path">{{ entry.path }}</span>
                </li>
                <li v-if="hiddenStagedFileCount > 0" class="staged-preview-more">
                  {{ hiddenStagedFileCount }} more staged
                </li>
              </ul>
            </form>
          </section>

          <section class="detail-panel git-overview-panel status-panel">
            <div class="panel-heading">
              <h3>Status</h3>
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

              <div v-else class="git-status-groups">
                <section
                  v-for="group in statusGroups(selectedDetails.gitStatus)"
                  :key="group.key"
                  class="git-status-group"
                  :class="[group.key, { empty: group.entries.length === 0 }]"
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

                  <p v-else>No {{ group.label.toLowerCase() }} changes.</p>
                </section>
              </div>
            </div>
          </section>

          <section class="detail-panel git-overview-panel branches-panel">
            <div class="panel-heading">
              <h3>Local branches</h3>
              <span class="panel-count">{{ selectedDetails.gitBranches.length }}</span>
            </div>
            <div class="git-branches">
              <div class="branch-filters" aria-label="Branch filters">
                <button
                  v-for="filter in branchFilters"
                  :key="filter.key"
                  type="button"
                  class="secondary"
                  :class="{ active: branchFilter === filter.key }"
                  @click="branchFilter = filter.key"
                >
                  {{ filter.label }}
                </button>
              </div>

              <p v-if="syncingBranchName" class="branch-pending">
                Syncing {{ syncingBranchName }}...
              </p>

              <ul v-if="filteredBranches.length > 0" class="git-branch-list">
                <li
                  v-for="branch in filteredBranches"
                  :key="branch.name"
                  :class="{ current: branch.current }"
                >
                  <div>
                    <strong>{{ branch.name }}</strong>
                    <small>
                      {{ branch.upstream ?? "No upstream" }}
                    </small>
                    <small v-if="branch.current">Current branch</small>
                    <span class="branch-health">
                      <span v-if="branch.ahead > 0">{{ branch.ahead }} ahead</span>
                      <span v-if="branch.behind > 0">{{ branch.behind }} behind</span>
                      <span v-if="branch.remoteGone">Remote gone</span>
                      <span v-if="branch.inSyncWithRemote">In sync</span>
                    </span>
                  </div>
                  <p v-if="branchFeedbackMessages[branch.name]" class="branch-feedback">
                    {{ branchFeedbackMessages[branch.name] }}
                  </p>
                  <p
                    v-else-if="branchSafetyNotes(branch, selectedDetails.gitStatus).length > 0"
                    class="branch-safety"
                  >
                    {{ branchSafetyNotes(branch, selectedDetails.gitStatus).join(" ") }}
                  </p>
                  <div class="branch-controls">
                    <span class="branch-sync" :class="{ synced: branch.inSyncWithRemote }">
                      {{ branchSyncLabel(branch) }}
                    </span>
                    <button
                      v-if="!branch.inSyncWithRemote"
                      type="button"
                      class="secondary branch-action"
                      :class="{ pending: isSyncingBranch(branch.name, syncingBranchName) }"
                      :disabled="
                        Boolean(branchSyncDisabledReason(branch, selectedDetails.gitStatus)) ||
                        Boolean(syncingBranchName) ||
                        Boolean(deletingBranchName)
                      "
                      :title="branchSyncTitle(branch, selectedDetails.gitStatus, syncingBranchName)"
                      :aria-busy="isSyncingBranch(branch.name, syncingBranchName)"
                      @click="$emit('syncBranch', branch.name)"
                    >
                      {{
                        isSyncingBranch(branch.name, syncingBranchName)
                          ? `${branchSyncActionLabel(branch)}ing...`
                          : branchSyncActionLabel(branch)
                      }}
                    </button>
                    <button
                      type="button"
                      class="secondary branch-action"
                      :class="{ pending: isDeletingBranch(branch.name, deletingBranchName) }"
                      :disabled="
                        !branch.canDelete || Boolean(syncingBranchName) || Boolean(deletingBranchName)
                      "
                      :title="branch.deleteReason ?? 'Delete local branch'"
                      @click="$emit('deleteBranch', branch.name)"
                    >
                      {{ isDeletingBranch(branch.name, deletingBranchName) ? "Removing..." : "Remove" }}
                    </button>
                  </div>
                </li>
              </ul>

              <p v-else>No branches match this filter.</p>
            </div>
          </section>

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
