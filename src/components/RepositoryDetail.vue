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

type RepositoryDetailTab = "git" | "log" | "health" | "scripts";

const props = defineProps<{
  selectedDetails: RepositoryDetails | null;
  selectedSummary?: RepositorySummary;
  activeDetailTab: RepositoryDetailTab;
  isDetailLoading: boolean;
  statusActionLabel: string | null;
  pendingStatusActionKey: string | null;
  commitClearToken: number;
  commitCelebrations: boolean;
  commitShortcutLabel: string;
  stageAllShortcutLabel: string;
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
  "update:activeDetailTab": [tab: RepositoryDetailTab];
}>();

const commitMessage = ref("");
const checkHealthBeforeCommit = ref(false);
const confettiBursts = ref<Array<{ id: number }>>([]);
const activeDetailTab = computed({
  get: () => props.activeDetailTab,
  set: (tab: RepositoryDetailTab) => emit("update:activeDetailTab", tab),
});
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
  () => props.selectedDetails?.gitStatus.mergeCommitMessage,
  (mergeCommitMessage) => {
    if (mergeCommitMessage && !commitMessage.value.trim()) {
      commitMessage.value = mergeCommitMessage;
    }
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
                          <kbd v-if="!isStagedGroup(group.key)">{{ stageAllShortcutLabel }}</kbd>
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

<style scoped>
.detail-view {
  display: grid;
  gap: 22px;
}

.empty-state {
  display: grid;
  justify-items: center;
  gap: 10px;
  border: 0;
  border-radius: 8px;
  padding: 40px 20px;
  color: var(--muted);
  text-align: center;
}

.empty-state strong {
  color: var(--text);
}

.empty-state span {
  max-width: 520px;
}

.detail-skeleton {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.skeleton-card {
  display: grid;
  gap: 12px;
  min-height: 196px;
  overflow: hidden;
  padding: 18px;
}

.skeleton-card span {
  display: block;
  height: 14px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    var(--surface-subtle),
    var(--surface-soft),
    var(--surface-subtle)
  );
  background-size: 220% 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
}

.skeleton-card span:first-child {
  width: 55%;
}

.skeleton-card span:nth-child(2) {
  width: 82%;
}

.skeleton-card span:nth-child(3) {
  width: 66%;
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 120% 0;
  }

  100% {
    background-position: -120% 0;
  }
}

:deep(.detail-tabs) {
  display: flex;
  position: sticky;
  z-index: 12;
  top: calc(var(--main-pane-top-padding, 0px) * -1);
  align-self: start;
  box-sizing: border-box;
  width: 100%;
  max-width: none;
  margin-right: calc(var(--main-pane-right-padding, 0px) * -1);
  margin-bottom: -1px;
  padding: var(--main-pane-top-padding, 0px)
    calc(16px + var(--main-pane-right-padding, 0px)) 0 16px;
  border-bottom: 1px solid
    color-mix(in srgb, var(--border-control) 82%, transparent);
  background: var(--app-bg);
}

.detail-view:has(> :deep(.detail-tabs)) {
  gap: 0;
}

:deep(.detail-tabs button) {
  display: inline-flex;
  position: relative;
  min-height: 36px;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  border-radius: 7px 7px 0 0;
  border-bottom: 0;
  border-color: transparent;
  margin-bottom: 1px;
  margin-left: -1px;
  padding: 3px 18px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--surface) 78%, transparent),
    color-mix(in srgb, var(--surface-soft) 74%, transparent)
  );
  color: var(--muted-strong);
  font-size: var(--font-size-base);
  font-weight: 900;
}

:deep(.detail-tabs button::before) {
  content: "";
  position: absolute;
  top: 0;
  right: 10px;
  left: 10px;
  height: 3px;
  border-radius: 0 0 999px 999px;
  background: transparent;
}

:deep(.detail-tabs button:hover:not(:disabled)) {
  border-color: color-mix(in srgb, var(--border-control) 82%, transparent);
  border-bottom-color: var(--border-control);
  background: var(--surface);
  color: var(--text);
}

:deep(.detail-tabs button.active:hover:not(:disabled)) {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--surface) 92%, var(--brand-ring)),
    var(--surface)
  );
}

:deep(.detail-tabs button.active) {
  z-index: 1;
  overflow: visible;
  min-height: 36px;
  margin-left: -1px;
  border-color: var(--brand);
  border-bottom-color: var(--surface);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--surface) 92%, var(--brand-ring)),
    var(--surface)
  );
  color: var(--brand-text-hover);
}

:deep(.detail-tabs button.active::before) {
  background: linear-gradient(90deg, var(--brand), var(--accent));
}

:deep(.detail-tabs button.active::after) {
  content: "";
  position: absolute;
  right: 0;
  bottom: -2px;
  left: 0;
  height: 2px;
  background: var(--surface);
}

.detail-layout {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}

:deep(.detail-tabs + .detail-layout) {
  position: relative;
  gap: 16px;
  border: 1px solid color-mix(in srgb, var(--border-control) 82%, transparent);
  border-bottom-left-radius: 8px;
  border-bottom-right-radius: 8px;
  padding: 18px 16px 16px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--surface) 92%, var(--app-bg)),
    color-mix(in srgb, var(--surface-soft) 58%, var(--surface))
  );
}

.git-main-grid {
  display: grid;
  min-width: 0;
  grid-template-columns: 1fr;
  gap: 16px;
  align-items: stretch;
}

.git-work-column {
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 16px;
}

.scripts-tab-layout {
  grid-template-columns: 1fr;
}

.detail-panel {
  display: grid;
  gap: 12px;
  border: 0;
  border-radius: 8px;
  padding: 12px;
  background: var(--surface);
}

.commit-panel {
  grid-column: 1 / -1;
  gap: 14px;
  border-top: 0;
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--accent) 10%, transparent),
      transparent 44%
    ),
    var(--surface-soft);
  box-shadow: none;
}

.git-work-column .commit-panel {
  grid-column: auto;
  padding: 0;
  background: transparent;
}

.git-work-column .commit-panel.ready {
  background: transparent;
}

.commit-panel.ready {
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--brand) 10%, transparent),
      transparent 44%
    ),
    var(--surface-soft);
}

.status-panel {
  grid-column: auto;
}

.git-overview-panel {
  grid-template-rows: auto minmax(0, 1fr);
  height: 620px;
  min-width: 0;
}

.git-work-column .git-overview-panel {
  height: auto;
  min-height: 0;
}

.git-work-column .git-status-card {
  height: auto;
  max-height: none;
  overflow: visible;
  overscroll-behavior: auto;
  scrollbar-gutter: auto;
}

.commit-changes-section {
  display: grid;
  gap: 10px;
  border-top: 0;
  padding-top: 4px;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-heading > div {
  min-width: 0;
}

.panel-subtitle {
  display: block;
  margin-top: 2px;
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
}

.panel-count {
  display: grid;
  min-width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 999px;
  background: var(--surface-subtle);
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

pre {
  min-height: 180px;
  max-height: 420px;
  margin: 0;
  overflow: auto;
  border: 0;
  border-radius: 8px;
  padding: 14px;
  background: var(--terminal-surface);
  color: var(--terminal-text);
  font-size: var(--font-size-base);
  line-height: 1.55;
  white-space: pre-wrap;
}

.compact-empty {
  padding: 24px 14px;
}

.clean-state {
  border: 0;
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--surface);
  color: var(--muted);
  font-size: var(--font-size-base);
  text-align: center;
}

.git-status-card {
  display: grid;
  gap: 12px;
  align-content: start;
  grid-auto-rows: max-content;
  height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.commit-form {
  display: grid;
  gap: 10px;
  border: 0;
  border-radius: 8px;
  padding: 10px;
  background: var(--surface);
}

.commit-form-wide {
  position: relative;
  grid-template-columns: minmax(0, 1fr) 132px;
  align-items: stretch;
  column-gap: 0;
  row-gap: 8px;
  border-color: transparent;
  padding: 10px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--surface) 82%, transparent),
    color-mix(in srgb, var(--surface-soft) 72%, transparent)
  );
  transition:
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;
}

.commit-panel.ready .commit-form-wide {
  border: 0;
  background:
    linear-gradient(
        135deg,
        color-mix(in srgb, var(--success-soft) 84%, var(--surface)),
        color-mix(in srgb, var(--surface) 82%, var(--success-soft))
      )
      padding-box,
    linear-gradient(90deg, var(--brand), var(--success-text), var(--accent))
      border-box;
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--surface) 70%, transparent),
    0 12px 26px color-mix(in srgb, var(--success-text) 12%, transparent);
}

.git-work-column .commit-form-wide,
.git-work-column .commit-panel.ready .commit-form-wide {
  border-radius: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
}

.commit-panel.ready .commit-form label,
.commit-panel.ready .commit-queue-heading span {
  color: var(--success-text);
}

.commit-panel.ready .commit-queue-heading strong {
  color: var(--success-text);
}

.commit-panel.ready .commit-form textarea {
  border-color: color-mix(
    in srgb,
    var(--success-text) 32%,
    var(--border-control)
  );
  background: color-mix(in srgb, var(--terminal-bg) 64%, var(--surface));
  color: var(--text);
}

.commit-panel.ready .commit-form textarea:focus {
  border-color: var(--success-text);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--success-text) 32%, transparent),
    inset 0 1px 3px color-mix(in srgb, var(--text) 12%, transparent),
    0 0 0 2px color-mix(in srgb, var(--success-text) 22%, transparent);
}

.commit-panel.ready .commit-submit:not(:disabled) {
  border-color: color-mix(in srgb, var(--success-text) 82%, var(--brand));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--success-text) 84%, var(--brand)),
    color-mix(in srgb, var(--brand) 82%, var(--success-text))
  );
  color: var(--brand-contrast);
  box-shadow: 0 8px 18px
    color-mix(in srgb, var(--success-text) 22%, transparent);
}

.commit-panel.ready .commit-submit:not(:disabled):hover {
  border-color: var(--success-text);
  background: var(--brand-hover);
  color: var(--brand-contrast);
}

.commit-panel.ready.celebration .commit-submit:not(:disabled) {
  position: relative;
  overflow: hidden;
  border-color: rgba(255, 255, 255, 0.42);
  background: linear-gradient(
    90deg,
    #ff4f8b 0%,
    #ff4f8b 10%,
    #ff8f3d 18%,
    #ffdd4d 28%,
    #59d66f 40%,
    #43d9ff 54%,
    #8b67ff 68%,
    #d85dff 80%,
    #ff4f8b 92%,
    #ff4f8b 100%
  );
  background-position: 0% 50%;
  background-size: 520% 100%;
  color: #ffffff;
  box-shadow:
    0 12px 26px rgba(255, 79, 139, 0.24),
    0 6px 18px rgba(67, 217, 255, 0.16),
    0 0 0 1px rgba(255, 255, 255, 0.24);
  text-shadow: 0 1px 1px rgba(14, 20, 25, 0.32);
  animation: rainbow-button-flow 8s linear infinite;
}

.commit-panel.ready.celebration .commit-submit:not(:disabled)::before {
  content: "";
  position: absolute;
  inset: -80% -30%;
  background: linear-gradient(
    115deg,
    transparent 30%,
    rgba(255, 255, 255, 0.5) 46%,
    transparent 62%
  );
  pointer-events: none;
  transform: translateX(-52%);
  animation: rainbow-button-sheen 2.8s ease-in-out infinite;
}

.commit-panel.ready.celebration .commit-submit:not(:disabled):hover {
  border-color: rgba(255, 255, 255, 0.58);
  background: linear-gradient(
    90deg,
    #ff347b 0%,
    #ff347b 10%,
    #ff7b35 18%,
    #ffd63d 28%,
    #43cb67 40%,
    #2fcdf5 54%,
    #7656f2 68%,
    #cf55ff 80%,
    #ff347b 92%,
    #ff347b 100%
  );
  background-size: 520% 100%;
  color: #ffffff;
  animation-duration: 4.5s;
  transform: translateY(-1px);
}

.commit-confetti {
  position: absolute;
  z-index: 2;
  top: 58px;
  right: 74px;
  width: 1px;
  height: 1px;
  pointer-events: none;
}

.commit-confetti span {
  position: absolute;
  width: 7px;
  height: 11px;
  border-radius: 2px;
  background: var(--confetti-color, #ffbe3d);
  opacity: 0;
  transform: translate(-50%, -50%) rotate(0deg);
  animation: commit-confetti-pop 900ms cubic-bezier(0.16, 0.92, 0.32, 1)
    forwards;
}

.commit-confetti span:nth-child(1) {
  --confetti-color: #ff4f8b;
  --confetti-x: -86px;
  --confetti-y: -64px;
  --confetti-rotate: -140deg;
}
.commit-confetti span:nth-child(2) {
  --confetti-color: #ffbe3d;
  --confetti-x: -58px;
  --confetti-y: -88px;
  --confetti-rotate: 90deg;
}
.commit-confetti span:nth-child(3) {
  --confetti-color: #59d66f;
  --confetti-x: -24px;
  --confetti-y: -104px;
  --confetti-rotate: 170deg;
}
.commit-confetti span:nth-child(4) {
  --confetti-color: #43d9ff;
  --confetti-x: 14px;
  --confetti-y: -92px;
  --confetti-rotate: -80deg;
}
.commit-confetti span:nth-child(5) {
  --confetti-color: #8b67ff;
  --confetti-x: 48px;
  --confetti-y: -70px;
  --confetti-rotate: 150deg;
}
.commit-confetti span:nth-child(6) {
  --confetti-color: #ff6b4a;
  --confetti-x: 82px;
  --confetti-y: -44px;
  --confetti-rotate: -120deg;
}
.commit-confetti span:nth-child(7) {
  --confetti-color: #43d9ff;
  --confetti-x: -96px;
  --confetti-y: -18px;
  --confetti-rotate: 110deg;
}
.commit-confetti span:nth-child(8) {
  --confetti-color: #59d66f;
  --confetti-x: -64px;
  --confetti-y: 12px;
  --confetti-rotate: -60deg;
}
.commit-confetti span:nth-child(9) {
  --confetti-color: #ff4f8b;
  --confetti-x: -26px;
  --confetti-y: 34px;
  --confetti-rotate: 220deg;
}
.commit-confetti span:nth-child(10) {
  --confetti-color: #ffbe3d;
  --confetti-x: 18px;
  --confetti-y: 32px;
  --confetti-rotate: -180deg;
}
.commit-confetti span:nth-child(11) {
  --confetti-color: #8b67ff;
  --confetti-x: 58px;
  --confetti-y: 14px;
  --confetti-rotate: 70deg;
}
.commit-confetti span:nth-child(12) {
  --confetti-color: #59d66f;
  --confetti-x: 96px;
  --confetti-y: -12px;
  --confetti-rotate: -210deg;
}
.commit-confetti span:nth-child(13) {
  --confetti-color: #ffbe3d;
  --confetti-x: -42px;
  --confetti-y: -42px;
  --confetti-rotate: 120deg;
  animation-delay: 45ms;
}
.commit-confetti span:nth-child(14) {
  --confetti-color: #43d9ff;
  --confetti-x: 40px;
  --confetti-y: -38px;
  --confetti-rotate: -90deg;
  animation-delay: 55ms;
}
.commit-confetti span:nth-child(15) {
  --confetti-color: #ff4f8b;
  --confetti-x: -12px;
  --confetti-y: -72px;
  --confetti-rotate: 260deg;
  animation-delay: 35ms;
}
.commit-confetti span:nth-child(16) {
  --confetti-color: #8b67ff;
  --confetti-x: 4px;
  --confetti-y: 58px;
  --confetti-rotate: -240deg;
  animation-delay: 65ms;
}
.commit-confetti span:nth-child(17) {
  --confetti-color: #59d66f;
  --confetti-x: 72px;
  --confetti-y: 42px;
  --confetti-rotate: 160deg;
  animation-delay: 40ms;
}
.commit-confetti span:nth-child(18) {
  --confetti-color: #ff6b4a;
  --confetti-x: -78px;
  --confetti-y: 46px;
  --confetti-rotate: -160deg;
  animation-delay: 50ms;
}

.branch-sync-confetti {
  z-index: 4;
  top: 50%;
  right: 52px;
}

.commit-panel.ready .commit-submit:disabled {
  border-color: color-mix(
    in srgb,
    var(--success-text) 18%,
    var(--border-control)
  );
  background: color-mix(in srgb, var(--surface-soft) 78%, var(--surface));
  color: color-mix(in srgb, var(--muted) 90%, transparent);
  opacity: 1;
}

.commit-panel.ready .commit-queue {
  background: color-mix(in srgb, var(--surface) 76%, transparent);
}

.commit-panel.ready .commit-queue p {
  color: var(--muted-strong);
}

.commit-panel.ready .staged-preview li {
  background: var(--surface);
  box-shadow: none;
}

.commit-panel.ready .staged-preview-file small {
  color: var(--muted);
}

@keyframes rainbow-button-flow {
  0% {
    background-position: 0% 50%;
  }

  100% {
    background-position: 100% 50%;
  }
}

@keyframes rainbow-button-sheen {
  0%,
  46% {
    transform: translateX(-62%);
  }

  78%,
  100% {
    transform: translateX(62%);
  }
}

@keyframes commit-confetti-pop {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.5) rotate(0deg);
  }

  12% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translate(
        calc(-50% + var(--confetti-x)),
        calc(-50% + var(--confetti-y) + 28px)
      )
      scale(1) rotate(var(--confetti-rotate));
  }
}

.commit-form label {
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  transition: color 140ms ease;
}

.commit-message-row {
  display: grid;
  gap: 7px;
  min-width: 0;
  position: relative;
}

.commit-form-wide .commit-message-row {
  display: contents;
}

.commit-form-wide .commit-message-row label {
  grid-column: 1;
  grid-row: 1;
  align-self: end;
  padding-left: 2px;
  line-height: 1.1;
}

.commit-form-wide .commit-message-row textarea {
  grid-column: 1;
  grid-row: 2;
}

.commit-message-row::after {
  content: "";
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 14px;
  height: 14px;
  border-right: 2px solid
    color-mix(in srgb, var(--border-muted) 58%, transparent);
  border-bottom: 2px solid
    color-mix(in srgb, var(--border-muted) 58%, transparent);
  border-radius: 0 0 4px;
  pointer-events: none;
}

.commit-message-row:focus-within label {
  color: var(--brand-text-hover);
}

.commit-message-row:focus-within::after {
  border-color: color-mix(in srgb, var(--brand) 72%, transparent);
}

.commit-form-wide .commit-message-row::after {
  content: none;
}

.commit-form textarea {
  width: 100%;
  min-height: 96px;
  resize: vertical;
  border: 1px solid var(--border-muted);
  border-left: 3px solid
    color-mix(in srgb, var(--brand) 58%, var(--border-control));
  border-radius: 6px;
  padding: 11px 13px 18px;
  background: color-mix(in srgb, var(--terminal-bg) 58%, var(--surface));
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--font-size-base);
  font-weight: 650;
  line-height: 1.45;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--text) 4%, transparent),
    inset 0 1px 3px color-mix(in srgb, var(--text) 10%, transparent);
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease,
    background-color 140ms ease;
}

.commit-form textarea::placeholder {
  color: color-mix(in srgb, var(--muted) 78%, transparent);
}

.commit-form textarea:focus {
  border-color: var(--brand);
  border-left-color: var(--brand);
  background: color-mix(in srgb, var(--terminal-bg) 72%, var(--surface));
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--brand) 28%, transparent),
    inset 0 1px 3px color-mix(in srgb, var(--text) 12%, transparent),
    0 0 0 2px color-mix(in srgb, var(--brand-ring) 76%, transparent);
  outline: 0;
}

.commit-form textarea:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.commit-form-wide textarea {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.commit-health-controls {
  grid-column: 1 / -1;
  grid-row: 1;
  display: flex;
  align-self: end;
  align-items: center;
  gap: 8px;
  justify-self: end;
}

.commit-health-check-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 850;
  line-height: 1;
  white-space: nowrap;
}

.commit-health-check-option input {
  width: 15px;
  height: 15px;
  accent-color: var(--brand);
}

.commit-health-controls button.commit-run-scripts {
  min-width: 0;
  min-height: 30px;
  border-radius: 7px;
  padding: 0 10px;
  background: color-mix(in srgb, var(--surface-subtle) 76%, var(--surface));
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  box-shadow:
    0 1px 0 color-mix(in srgb, var(--surface) 68%, transparent),
    0 4px 12px color-mix(in srgb, var(--text) 4%, transparent);
}

.commit-health-controls button.commit-run-scripts:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--brand) 32%, var(--border-control));
  background: color-mix(in srgb, var(--surface) 82%, var(--brand-soft));
  color: var(--text);
}

.commit-submit {
  display: inline-flex;
  grid-column: 2;
  grid-row: 2;
  width: 100%;
  min-width: 0;
  min-height: 96px;
  align-items: center;
  align-self: stretch;
  justify-content: center;
  flex-direction: column;
  gap: 5px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  margin-left: -1px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--surface-soft) 72%, var(--surface)),
    color-mix(in srgb, var(--surface-subtle) 56%, var(--surface))
  );
  color: var(--muted-strong);
}

.commit-submit span {
  line-height: 1.1;
}

.commit-submit-shortcut {
  height: 18px;
  min-width: 30px;
  padding-bottom: 1px;
  transform: translateY(-1px);
}

.commit-submit:disabled {
  border-color: color-mix(in srgb, var(--border-control) 82%, transparent);
  background: color-mix(in srgb, var(--surface-soft) 76%, var(--surface));
  color: color-mix(in srgb, var(--muted) 88%, transparent);
  opacity: 1;
}

.commit-form-wide textarea:focus {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--brand) 28%, transparent),
    inset 0 1px 3px color-mix(in srgb, var(--text) 12%, transparent);
}

.commit-panel.ready .commit-form-wide textarea:focus {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--success-text) 32%, transparent),
    inset 0 1px 3px color-mix(in srgb, var(--text) 12%, transparent);
}

.commit-line-summary {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  margin-top: -7px;
  border-radius: 6px;
  padding: 0 2px;
  color: color-mix(in srgb, var(--muted) 88%, transparent);
  font-size: var(--font-size-compact);
  font-weight: 800;
}

.commit-line-summary span {
  color: var(--muted);
  text-transform: uppercase;
}

.commit-queue {
  display: grid;
  grid-column: 1 / -1;
  gap: 8px;
  border: 0;
  border-radius: 8px;
  padding: 12px;
  background: color-mix(in srgb, var(--surface) 48%, transparent);
}

.commit-queue-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.commit-queue-title {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.commit-queue-heading span {
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.commit-queue-heading strong {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.commit-queue-action {
  flex: 0 0 auto;
}

.commit-queue p {
  margin-bottom: 0;
  color: var(--muted);
  font-size: var(--font-size-base);
}

.staged-preview {
  display: grid;
  gap: 4px;
  margin: 0;
  overflow: visible;
  padding: 0;
  list-style: none;
}

.commit-form-wide .staged-preview {
  grid-template-columns: 1fr;
}

.staged-preview li {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 7px;
  align-items: center;
  border: 0;
  border-radius: 6px;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--success-soft) 38%, var(--surface));
}

.staged-preview-action {
  align-self: center;
  min-height: 30px;
  padding: 0 9px;
  font-size: var(--font-size-compact);
}

.staged-preview-file {
  display: grid;
  min-width: 0;
  min-height: 0;
  justify-items: stretch;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  text-align: left;
}

.staged-preview-file:hover:not(:disabled) {
  background: transparent;
  color: inherit;
}

.staged-preview code {
  display: grid;
  min-height: 22px;
  place-items: center;
  border-radius: 5px;
  background: color-mix(in srgb, var(--success-text) 10%, transparent);
  color: var(--success-text);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.staged-preview-file > span {
  min-width: 0;
  direction: rtl;
  overflow: hidden;
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 800;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.staged-preview-file small {
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.staged-preview-file small.status-line-meta,
.status-file-button small.status-line-meta {
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-line-additions {
  color: var(--success-text);
}

.status-line-deletions {
  color: var(--danger-text);
}

.commit-form button:not(.commit-submit) {
  justify-self: start;
  min-height: 34px;
  padding: 0 12px;
  font-size: var(--font-size-base);
}

.status-pending {
  border-radius: 7px;
  margin-bottom: 0;
  padding: 8px 10px;
  background: var(--warning-soft);
  color: var(--warning-text);
  font-size: var(--font-size-base);
  font-weight: 800;
}

.status-feedback,
.branch-feedback {
  border-radius: 7px;
  margin-bottom: 0;
  padding: 8px 10px;
  background: var(--success-soft);
  color: var(--success-text);
  font-size: var(--font-size-base);
  font-weight: 800;
}

.branch-conflict-feedback {
  border-radius: 7px;
  margin-bottom: 0;
  padding: 8px 10px;
  background: var(--danger-soft);
  color: var(--danger-text);
  font-size: var(--font-size-base);
  font-weight: 800;
}

.branch-safety {
  grid-column: 1 / -1;
  margin-bottom: 0;
  color: var(--muted);
  font-size: var(--font-size-compact);
}

.git-status-groups {
  display: grid;
  gap: 8px;
}

.status-counts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.status-counts div {
  border: 0;
  border-radius: 8px;
  padding: 10px 11px;
  background: color-mix(in srgb, var(--surface) 60%, transparent);
}

.status-counts div.active {
  background: var(--surface-hover);
}

.status-counts div.staged.active {
  background: var(--success-soft);
}

.status-counts div.unstaged.active {
  background: var(--warning-soft);
}

.status-counts div.untracked.active {
  background: var(--info-soft);
}

.status-counts div.conflicted.active {
  background: var(--danger-soft);
}

.status-counts strong,
.status-counts span {
  display: block;
}

.status-counts strong {
  font-size: var(--font-size-title);
  line-height: 1;
}

.status-counts span {
  margin-top: 3px;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}
.git-status-group.empty {
  background: var(--surface-soft);
}

.git-status-group-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.git-status-group-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.git-status-group-heading h4 {
  margin-bottom: 0;
  font-size: var(--font-size-base);
}

.git-status-group-title span {
  display: grid;
  min-width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 999px;
  background: var(--surface-subtle);
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.git-status-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.git-status-list li {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: start;
  border-radius: 7px;
  padding: 8px;
  background: var(--surface-soft);
}

.git-status-list code {
  display: grid;
  min-height: 24px;
  min-width: 34px;
  place-items: center;
  border-radius: 6px;
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  white-space: pre;
}

.status-code.staged {
  background: var(--success-soft);
  color: var(--success-text);
}

.status-code.unstaged {
  background: var(--warning-soft);
  color: var(--warning-text);
}

.status-code.untracked {
  background: var(--info-soft);
  color: var(--info-text);
}

.status-code.conflicted {
  background: var(--danger-soft);
  color: var(--danger-text);
}

.git-status-list strong,
.git-status-list small,
.status-file-button strong,
.status-file-button small {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
}

.git-status-list strong,
.status-file-button strong {
  font-size: var(--font-size-base);
}

.git-status-list small,
.status-file-button small,
.git-status-group p {
  margin-bottom: 0;
  color: var(--muted);
  font-size: var(--font-size-compact);
}

.status-file-button {
  display: grid;
  min-width: 0;
  min-height: 0;
  border: 0;
  border-radius: 6px;
  padding: 2px 4px;
  background: transparent;
  color: inherit;
  font-weight: 400;
  text-align: left;
}

.status-file-button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text);
}

.status-file-button:disabled {
  opacity: 0.72;
}

.status-action {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 0 10px;
  font-size: var(--font-size-compact);
  white-space: nowrap;
}

.status-action kbd {
  display: inline-grid;
  min-width: 28px;
  height: 20px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--border-control) 72%, transparent);
  border-radius: 5px;
  padding: 0 5px;
  background: color-mix(in srgb, var(--surface-subtle) 74%, transparent);
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  line-height: 1;
}

.status-action.pending,
.branch-action.pending {
  border-color: var(--focus);
}
</style>
