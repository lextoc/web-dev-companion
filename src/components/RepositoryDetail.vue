<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  CommitDetails,
  GitStatusEntry,
  ProjectDependencyHealth,
  ProjectHealth,
  RepositoryDetails,
  RepositorySummary,
  ScriptTerminal,
  StatusFileDiff,
  StatusFileDiffType,
} from "../repositories";
import RepositoryCommitDetailsModal from "./repository-detail/RepositoryCommitDetailsModal.vue";
import RepositoryGitLogPanel from "./repository-detail/RepositoryGitLogPanel.vue";
import RepositoryStatusDiffModal from "./repository-detail/RepositoryStatusDiffModal.vue";
import { NpmScriptsPanel, ProjectHealthPanel, RunProjectHealthScriptsButton } from "./smart";
import { AppTabs, type AppTabItem } from "./ui";

const props = defineProps<{
  selectedDetails: RepositoryDetails | null;
  selectedSummary?: RepositorySummary;
  isDetailLoading: boolean;
  statusActionLabel: string | null;
  pendingStatusActionKey: string | null;
  commitClearToken: number;
  commitCelebrations: boolean;
  commitShortcutLabel: string;
  unstageAllShortcutLabel: string;
  npmScripts: [string, string][];
  pinnedScriptNames: string[];
  scriptTerminalsByScript: Record<string, ScriptTerminal>;
}>();

const emit = defineEmits<{
  refresh: [];
  stageFiles: [request: { paths: string[]; actionKey: string }];
  unstageFiles: [request: { paths: string[]; actionKey: string }];
  commit: [request: { message: string; checkHealthBeforeCommit: boolean; healthScriptNames: string[] }];
  commitDraftChange: [hasDraft: boolean];
  runScript: [scriptName: string];
  togglePinScript: [scriptName: string];
  stopScript: [scriptName: string];
  restartScript: [scriptName: string];
  openTerminal: [scriptName: string];
  openCommitInBrowser: [hash: string];
}>();

const commitMessage = ref("");
const checkHealthBeforeCommit = ref(false);
const confettiBursts = ref<Array<{ id: number }>>([]);
const activeDetailTab = ref<"git" | "log" | "health" | "scripts">("git");
const detailTabs: AppTabItem[] = [
  { key: "git", label: "Git overview" },
  { key: "log", label: "Git log" },
  { key: "health", label: "Health" },
  { key: "scripts", label: "NPM scripts" },
];
const statusLineStats = ref<Record<string, { additions: number; deletions: number }>>({});
const selectedStatusDiff = ref<StatusFileDiff | null>(null);
const statusDiffLoadingKey = ref<string | null>(null);
const statusDiffError = ref<string | null>(null);
const selectedCommitDetails = ref<CommitDetails | null>(null);
const commitDetailsLoadingHash = ref<string | null>(null);
const commitDetailsError = ref<string | null>(null);
const projectHealth = ref<ProjectHealth | null>(null);
const projectHealthLoading = ref(false);
const projectHealthError = ref<string | null>(null);
const projectOutdatedLoading = ref(false);
let nextConfettiBurstId = 0;
let nextCommitDetailsRequestId = 0;
let activeCommitDetailsRequestId = 0;
let nextStatusLineStatsRequestId = 0;
let activeStatusLineStatsRequestId = 0;
let nextProjectHealthRequestId = 0;
let activeProjectHealthRequestId = 0;
const stagedPreview = computed(() => props.selectedDetails?.gitStatus.staged ?? []);
const stagedLineTotals = computed(() =>
  stagedPreview.value.reduce(
    (totals, entry) => {
      const stats = statusLineStats.value[statusDiffKey("staged", entry)];

      return {
        additions: totals.additions + (stats?.additions ?? 0),
        deletions: totals.deletions + (stats?.deletions ?? 0),
      };
    },
    { additions: 0, deletions: 0 },
  ),
);
const availableProjectHealthScriptNames = computed(() =>
  projectHealth.value?.scripts.filter((script) => script.present).map((script) => script.name) ?? [],
);

watch(
  () => props.commitClearToken,
  () => {
    commitMessage.value = "";
    triggerCommitConfetti();
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
    resetProjectHealth();
    void loadProjectHealth();
  },
  { immediate: true },
);

watch(
  () => [props.selectedDetails?.path, props.selectedDetails?.gitStatus.raw] as const,
  () => {
    void loadStatusLineStats();
  },
  { immediate: true },
);

watch(commitMessage, (message) => {
  emit("commitDraftChange", Boolean(message.trim()));
});

onMounted(() => {
  window.addEventListener("keydown", handleRepositoryDetailKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleRepositoryDetailKeydown);
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

function resetProjectHealth() {
  activeProjectHealthRequestId = ++nextProjectHealthRequestId;
  projectHealth.value = null;
  projectHealthLoading.value = false;
  projectHealthError.value = null;
  projectOutdatedLoading.value = false;
}

async function loadProjectHealth() {
  const repoPath = props.selectedDetails?.path;

  if (!repoPath) {
    resetProjectHealth();
    return;
  }

  const requestId = ++nextProjectHealthRequestId;
  activeProjectHealthRequestId = requestId;
  projectHealthLoading.value = true;
  projectHealthError.value = null;

  try {
    const health = await window.repositories.health(repoPath);

    if (activeProjectHealthRequestId === requestId && props.selectedDetails?.path === repoPath) {
      projectHealth.value = health;
    }
  } catch (error) {
    if (activeProjectHealthRequestId === requestId) {
      projectHealthError.value = error instanceof Error ? error.message : "Could not read project health.";
    }
  } finally {
    if (activeProjectHealthRequestId === requestId) {
      projectHealthLoading.value = false;
    }
  }
}

async function checkOutdatedDependencies() {
  const repoPath = props.selectedDetails?.path;

  if (!repoPath || projectOutdatedLoading.value) {
    return;
  }

  projectOutdatedLoading.value = true;
  projectHealthError.value = null;

  try {
    const dependencies = await window.repositories.checkOutdatedDependencies(repoPath);

    if (props.selectedDetails?.path === repoPath) {
      mergeProjectDependencies(dependencies);
    }
  } catch (error) {
    if (props.selectedDetails?.path === repoPath) {
      mergeProjectDependencies({
        status: "failed",
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Could not check outdated dependencies.",
      });
    }
  } finally {
    if (props.selectedDetails?.path === repoPath) {
      projectOutdatedLoading.value = false;
    }
  }
}

function mergeProjectDependencies(dependencies: ProjectDependencyHealth) {
  if (!projectHealth.value) {
    return;
  }

  projectHealth.value = {
    ...projectHealth.value,
    dependencies,
  };
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

function parseStatusLineStats(content: string) {
  let additions = 0;
  let deletions = 0;

  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }

    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function statusLineStatsFor(groupKey: string, entry: GitStatusEntry) {
  return statusLineStats.value[statusDiffKey(groupKey, entry)];
}

function statusLineStatRequests(gitStatus: RepositoryDetails["gitStatus"]) {
  return [
    ...gitStatus.staged.map((entry) => ({ entry, groupKey: "staged" })),
    ...statusGroups(gitStatus).flatMap((group) =>
      group.entries.map((entry) => ({ entry, groupKey: group.key })),
    ),
  ];
}

async function loadStatusLineStats() {
  const selectedDetails = props.selectedDetails;
  const requestId = ++nextStatusLineStatsRequestId;
  activeStatusLineStatsRequestId = requestId;
  statusLineStats.value = {};

  if (!selectedDetails) {
    return;
  }

  for (const { entry, groupKey } of statusLineStatRequests(selectedDetails.gitStatus)) {
    try {
      const diff = await window.repositories.diffFile({
        repoPath: selectedDetails.path,
        path: entry.path,
        diffType: statusDiffType(groupKey),
      });

      if (activeStatusLineStatsRequestId !== requestId) {
        return;
      }

      statusLineStats.value = {
        ...statusLineStats.value,
        [statusDiffKey(groupKey, entry)]: parseStatusLineStats(diff.content),
      };
    } catch {
      if (activeStatusLineStatsRequestId !== requestId) {
        return;
      }
    }
  }
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

function isRepositoryDetailModalOpen() {
  return (
    Boolean(selectedStatusDiff.value || statusDiffError.value) ||
    Boolean(selectedCommitDetails.value || commitDetailsLoadingHash.value || commitDetailsError.value)
  );
}

function hasAppLevelModalOpen() {
  return Boolean(
    document.querySelector(
      ".command-palette-backdrop, .terminal-modal-backdrop, .modal-backdrop:not(.commit-detail-backdrop):not(.status-diff-backdrop)",
    ),
  );
}

function handleRepositoryDetailKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented || !isRepositoryDetailModalOpen()) {
    return;
  }

  if (hasAppLevelModalOpen()) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  if (selectedStatusDiff.value || statusDiffError.value) {
    closeStatusDiff();
    return;
  }

  closeCommitDetails();
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

  if (checkHealthBeforeCommit.value && projectHealthLoading.value) {
    return "Project health is still loading.";
  }

  if (checkHealthBeforeCommit.value && !projectHealth.value) {
    return "Project health has not loaded.";
  }

  if (checkHealthBeforeCommit.value && availableProjectHealthScriptNames.value.length === 0) {
    return "No health scripts are available.";
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

  emit("commit", {
    message,
    checkHealthBeforeCommit: checkHealthBeforeCommit.value,
    healthScriptNames: availableProjectHealthScriptNames.value,
  });
}

function handleCommitMessageKeydown(
  event: KeyboardEvent,
  gitStatus: RepositoryDetails["gitStatus"],
  isDetailLoading: boolean,
  pendingStatusActionKey: string | null,
) {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.altKey) {
    event.preventDefault();
    submitCommit(gitStatus, isDetailLoading, pendingStatusActionKey);
  }
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
      <AppTabs
        v-model="activeDetailTab"
        :tabs="detailTabs"
        label="Repository detail sections"
        tablist-class="detail-tabs"
        panel-class="detail-layout scripts-tab-layout"
      >
        <template #git>
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
                    @keydown="
                      handleCommitMessageKeydown(
                        $event,
                        selectedDetails.gitStatus,
                        isDetailLoading,
                        pendingStatusActionKey,
                      )
                    "
                  ></textarea>
                </div>

                <div class="commit-health-controls">
                  <label class="commit-health-check-option">
                    <input v-model="checkHealthBeforeCommit" type="checkbox" />
                    <span>Before commit</span>
                  </label>
                  <RunProjectHealthScriptsButton
                    class="secondary commit-run-scripts"
                    :health="projectHealth"
                    :loading="projectHealthLoading"
                    :script-terminals-by-script="scriptTerminalsByScript"
                    @run-script="$emit('runScript', $event)"
                    @restart-script="$emit('restartScript', $event)"
                  />
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
                  <span>
                    {{ pendingStatusActionKey === "commit" ? "Committing..." : "Commit" }}
                  </span>
                  <kbd
                    v-if="pendingStatusActionKey !== 'commit'"
                    class="shortcut-label commit-submit-shortcut"
                  >
                    {{ commitShortcutLabel }}
                  </kbd>
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

              <div v-if="stagedPreview.length" class="commit-line-summary" aria-label="Staged line changes">
                <span>Staged lines</span>
                <strong class="status-line-additions">+{{ stagedLineTotals.additions }}</strong>
                <strong class="status-line-deletions">-{{ stagedLineTotals.deletions }}</strong>
              </div>

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
                      <div class="commit-queue-title">
                        <span>Staged queue</span>
                        <strong>{{ stagedFileLabel(selectedDetails.gitStatus) }}</strong>
                      </div>
                      <button
                        v-if="stagedPreview.length > 0"
                        type="button"
                        class="secondary status-action commit-queue-action"
                        :class="{ pending: isStatusActionPending('staged', stagedPreview) }"
                        :disabled="Boolean(pendingStatusActionKey)"
                        @click="emitStatusAction('staged', stagedPreview)"
                      >
                        {{
                          isStatusActionPending('staged', stagedPreview)
                            ? "Unstaging..."
                            : "Unstage all"
                        }}
                        <kbd>{{ unstageAllShortcutLabel }}</kbd>
                      </button>
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
                          <small v-if="statusDiffLoadingKey === statusDiffKey('staged', entry)">
                            Loading changes...
                          </small>
                          <small v-else class="status-line-meta">
                            <template v-if="statusLineStatsFor('staged', entry)">
                              <span class="status-line-additions">
                                +{{ statusLineStatsFor('staged', entry)?.additions }}
                              </span>
                              <span class="status-line-deletions">
                                -{{ statusLineStatsFor('staged', entry)?.deletions }}
                              </span>
                              <span aria-hidden="true">·</span>
                            </template>
                            <span>View changes</span>
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
                            <small v-if="statusDiffLoadingKey === statusDiffKey(group.key, entry)">
                              Loading changes...
                            </small>
                            <small v-else class="status-line-meta">
                              <template v-if="statusLineStatsFor(group.key, entry)">
                                <span class="status-line-additions">
                                  +{{ statusLineStatsFor(group.key, entry)?.additions }}
                                </span>
                                <span class="status-line-deletions">
                                  -{{ statusLineStatsFor(group.key, entry)?.deletions }}
                                </span>
                                <span aria-hidden="true">·</span>
                              </template>
                              <span>{{ entry.label }}</span>
                              <span aria-hidden="true">·</span>
                              <span>View changes</span>
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
        </div>
        </template>

        <template #log>
        <RepositoryGitLogPanel
          :git-log="selectedDetails.gitLog"
          :commit-details-loading-hash="commitDetailsLoadingHash"
          :selected-commit-hash="selectedCommitDetails?.hash"
          :selected-commit-full-hash="selectedCommitDetails?.fullHash"
          @open-commit-details="openCommitDetails"
          @open-commit-in-browser="$emit('openCommitInBrowser', $event)"
        />
        </template>

        <template #health>
        <ProjectHealthPanel
          :health="projectHealth"
          :loading="projectHealthLoading"
          :error="projectHealthError"
          :outdated-loading="projectOutdatedLoading"
          :script-terminals-by-script="scriptTerminalsByScript"
          @refresh="loadProjectHealth"
          @check-outdated="checkOutdatedDependencies"
          @run-script="$emit('runScript', $event)"
          @restart-script="$emit('restartScript', $event)"
          @open-terminal="$emit('openTerminal', $event)"
        />
        </template>

        <template #scripts>
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
        </template>
      </AppTabs>
    </template>

    <div v-else class="empty-state">
      <strong>{{ selectedSummary?.name ?? "Repository" }} could not be loaded.</strong>
      <span>Check whether the folder still exists and is available, then refresh.</span>
      <button type="button" class="secondary" :disabled="isDetailLoading" @click="$emit('refresh')">
        Retry
      </button>
    </div>

    <RepositoryCommitDetailsModal
      v-if="selectedCommitDetails || commitDetailsLoadingHash || commitDetailsError"
      :commit-details="selectedCommitDetails"
      :error="commitDetailsError"
      :loading-hash="commitDetailsLoadingHash"
      @close="closeCommitDetails"
    />

    <RepositoryStatusDiffModal
      v-if="selectedStatusDiff || statusDiffError"
      :error="statusDiffError"
      :status-diff="selectedStatusDiff"
      @close="closeStatusDiff"
    />
  </section>
</template>
