<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { parseDiffOutput } from "../output-formatting";
import type {
  CommitChangedFile,
  CommitDetails,
  GitStatusEntry,
  ProjectDependencyHealth,
  ProjectHealth,
  ProjectHealthStatus,
  ProjectScriptCheck,
  RepositoryDetails,
  RepositorySummary,
  ScriptTerminal,
  StatusFileDiff,
  StatusFileDiffType,
} from "../repositories";
import NpmScriptsPanel from "./NpmScriptsPanel.vue";
import { RunProjectScriptsButton } from "./smart";
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
const activeCommitDiffSectionKey = ref<string | null>(null);
const commitDiffSectionRefs = ref<Record<string, HTMLElement | null>>({});
const selectedStatusDiffLines = computed(() => parseDiffOutput(selectedStatusDiff.value?.content ?? ""));
const selectedCommitDiffSections = computed(() => {
  const details = selectedCommitDetails.value;

  if (!details?.diff.trim()) {
    return [];
  }

  const rawSections: Array<{ path: string | null; lines: string[] }> = [];
  let currentSection: { path: string | null; lines: string[] } | null = null;

  for (const line of details.diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (currentSection) {
        rawSections.push(currentSection);
      }

      currentSection = {
        path: diffHeaderPath(line),
        lines: [line],
      };
      continue;
    }

    if (!currentSection) {
      currentSection = {
        path: null,
        lines: [],
      };
    }

    currentSection.lines.push(line);
  }

  if (currentSection) {
    rawSections.push(currentSection);
  }

  return rawSections.map((section, sectionIndex) => {
    const fileIndex = commitFileIndexForDiffSection(details.files, section.path, sectionIndex);
    const file = fileIndex === -1 ? undefined : details.files[fileIndex];
    const path = section.path ?? file?.path ?? `Patch ${sectionIndex + 1}`;
    const key = file ? commitFileKey(file, fileIndex) : `diff-section:${sectionIndex}:${path}`;

    return {
      key,
      path,
      originalPath: file?.originalPath,
      lines: parseDiffOutput(section.lines.join("\n")),
    };
  });
});
let nextConfettiBurstId = 0;
let nextCommitDetailsRequestId = 0;
let activeCommitDetailsRequestId = 0;
let nextStatusLineStatsRequestId = 0;
let activeStatusLineStatsRequestId = 0;
let nextProjectHealthRequestId = 0;
let activeProjectHealthRequestId = 0;
const logDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

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

function projectHealthIssueCount(health: ProjectHealth) {
  return projectHealthAttentionItems(health).length;
}

function projectHealthAttentionItems(health: ProjectHealth) {
  const groupedMessages = [
    { key: "package", title: "Package manager", messages: health.packageManager.messages },
    { key: "node", title: "Node", messages: health.node.messages },
    { key: "install", title: "Install state", messages: health.install.messages },
    { key: "lockfile", title: "Lockfile", messages: health.lockfile.messages },
  ];
  const items = groupedMessages.flatMap((group) =>
    group.messages.map((entry) => ({
      key: `${group.key}-${entry.text}`,
      level: entry.level,
      title: group.title,
      text: entry.text,
    })),
  );

  if (health.dependencies.status === "outdated") {
    items.push({
      key: "dependencies-outdated",
      level: "warning",
      title: "Dependencies",
      text: `${health.dependencies.outdatedCount ?? 0} outdated dependencies found.`,
    });
  }

  if (health.dependencies.status === "failed") {
    items.push({
      key: "dependencies-failed",
      level: "error",
      title: "Dependencies",
      text: health.dependencies.error ?? "Outdated dependency check failed.",
    });
  }

  for (const script of health.scripts.filter((entry) => ["failed", "timed-out"].includes(entry.status))) {
    items.push({
      key: `script-${script.name}`,
      level: "error",
      title: script.name,
      text: script.error ?? `Script ${scriptStatusLabel(script).toLowerCase()}.`,
    });
  }

  return items;
}

function projectHealthOverallStatus(health: ProjectHealth): ProjectHealthStatus {
  if (
    health.packageManager.status === "error" ||
    health.node.status === "error" ||
    health.install.status === "error" ||
    health.lockfile.status === "error" ||
    health.dependencies.status === "failed" ||
    health.scripts.some((script) => ["failed", "timed-out"].includes(script.status))
  ) {
    return "error";
  }

  if (
    health.packageManager.status === "warning" ||
    health.node.status === "warning" ||
    health.install.status === "warning" ||
    health.lockfile.status === "warning" ||
    health.dependencies.status === "outdated"
  ) {
    return "warning";
  }

  if (
    health.packageManager.status === "unknown" ||
    health.node.status === "unknown" ||
    health.install.status === "unknown" ||
    health.lockfile.status === "unknown"
  ) {
    return "unknown";
  }

  return "ok";
}

function healthStatusLabel(status: ProjectHealthStatus) {
  if (status === "ok") {
    return "OK";
  }

  if (status === "warning") {
    return "Warning";
  }

  if (status === "error") {
    return "Error";
  }

  return "Unknown";
}

function dependencyStatusLabel(dependencies: ProjectDependencyHealth) {
  if (dependencies.status === "ok") {
    return "Up to date";
  }

  if (dependencies.status === "outdated") {
    return `${dependencies.outdatedCount ?? 0} outdated`;
  }

  if (dependencies.status === "failed") {
    return "Failed";
  }

  if (dependencies.status === "skipped") {
    return "Skipped";
  }

  return "Not checked";
}

function dependencyDetailLabel(dependencies: ProjectDependencyHealth) {
  if (dependencies.status === "outdated") {
    return `${dependencies.outdatedCount ?? 0} dependencies`;
  }

  if (dependencies.status === "ok") {
    return "No outdated dependencies found";
  }

  if (dependencies.status === "failed") {
    return "Check failed";
  }

  if (dependencies.status === "skipped") {
    return dependencies.error ?? "Check skipped";
  }

  return "Manual check not run";
}

function outdatedDependencyVersionLabel(current?: string, wanted?: string, latest?: string) {
  if (current && wanted && latest) {
    return `${current} -> ${wanted} / ${latest}`;
  }

  if (current && latest) {
    return `${current} -> ${latest}`;
  }

  if (wanted && latest) {
    return `${wanted} / ${latest}`;
  }

  return current ?? wanted ?? latest ?? "Version unknown";
}

function scriptStatusLabel(script: ProjectScriptCheck) {
  if (script.status === "passed") {
    return "Passed";
  }

  if (script.status === "failed") {
    return "Failed";
  }

  if (script.status === "timed-out") {
    return "Timed out";
  }

  if (script.status === "skipped") {
    return "Missing";
  }

  return "Not run";
}

function projectScriptTerminal(scriptName: string) {
  return props.scriptTerminalsByScript[scriptName];
}

function projectScriptRuntimeStatus(script: ProjectScriptCheck) {
  const terminal = projectScriptTerminal(script.name);

  if (!terminal) {
    return script.status;
  }

  return terminal.isRunning ? "running" : "finished";
}

function projectScriptRuntimeStatusLabel(script: ProjectScriptCheck) {
  const terminal = projectScriptTerminal(script.name);

  if (!terminal) {
    return scriptStatusLabel(script);
  }

  return terminal.isRunning ? "Running" : "Finished";
}

function openOrRunProjectScript(script: ProjectScriptCheck) {
  if (!script.present) {
    return;
  }

  if (projectScriptTerminal(script.name)) {
    emit("openTerminal", script.name);
    return;
  }

  emit("runScript", script.name);
}

function healthCheckedAtLabel(checkedAt?: string) {
  if (!checkedAt) {
    return "Not checked";
  }

  const date = new Date(checkedAt);

  if (Number.isNaN(date.getTime())) {
    return "Not checked";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scriptDurationLabel(durationMs?: number) {
  if (durationMs === undefined) {
    return "";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

function availableProjectScripts(health: ProjectHealth) {
  return health.scripts.filter((script) => script.present);
}

function missingProjectScripts(health: ProjectHealth) {
  return health.scripts.filter((script) => !script.present);
}

function missingProjectScriptSummary(health: ProjectHealth) {
  const missingScripts = missingProjectScripts(health);

  if (missingScripts.length === 0) {
    return "";
  }

  return `${missingScripts.length} common scripts missing: ${missingScripts.map((script) => script.name).join(", ")}`;
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

function commitFileKey(file: CommitChangedFile, index: number) {
  return `${index}:${file.originalPath ?? ""}:${file.path}`;
}

function diffHeaderPath(line: string) {
  const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);

  return match?.[2] ?? null;
}

function commitFileIndexForDiffSection(
  files: CommitChangedFile[],
  sectionPath: string | null,
  sectionIndex: number,
) {
  if (sectionPath) {
    const pathIndex = files.findIndex(
      (file) => file.path === sectionPath || file.originalPath === sectionPath,
    );

    if (pathIndex !== -1) {
      return pathIndex;
    }
  }

  return files[sectionIndex] ? sectionIndex : -1;
}

function commitDiffSectionKey(file: CommitChangedFile, index: number) {
  const fileKey = commitFileKey(file, index);
  const matchingSection =
    selectedCommitDiffSections.value.find((section) => section.key === fileKey) ??
    selectedCommitDiffSections.value.find(
      (section) =>
        section.path === file.path ||
        (Boolean(file.originalPath) && section.originalPath === file.originalPath),
    );

  return matchingSection?.key ?? null;
}

function setCommitDiffSectionRef(key: string, element: unknown) {
  commitDiffSectionRefs.value[key] = element instanceof HTMLElement ? element : null;
}

function scrollToCommitFile(file: CommitChangedFile, index: number) {
  const sectionKey = commitDiffSectionKey(file, index);

  if (!sectionKey) {
    return;
  }

  activeCommitDiffSectionKey.value = sectionKey;
  commitDiffSectionRefs.value[sectionKey]?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
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
  activeCommitDiffSectionKey.value = null;
  commitDiffSectionRefs.value = {};

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
  activeCommitDiffSectionKey.value = null;
  commitDiffSectionRefs.value = {};
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

                <RunProjectScriptsButton
                  class="secondary commit-run-scripts"
                  :health="projectHealth"
                  :loading="projectHealthLoading"
                  :script-terminals-by-script="scriptTerminalsByScript"
                  @run-script="$emit('runScript', $event)"
                  @restart-script="$emit('restartScript', $event)"
                />

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
        </template>

        <template #health>
        <section class="detail-panel project-health-panel" aria-live="polite">
          <header class="project-health-header">
            <div>
              <span>Project health</span>
              <h3>
                {{
                  projectHealth
                    ? `${healthStatusLabel(projectHealthOverallStatus(projectHealth))} · ${projectHealthIssueCount(projectHealth)} issues`
                    : "Checking project"
                }}
              </h3>
              <small v-if="projectHealth">
                Updated {{ healthCheckedAtLabel(projectHealth.checkedAt) }}
              </small>
            </div>

            <div class="project-health-actions">
              <button type="button" class="secondary" :disabled="projectHealthLoading" @click="loadProjectHealth">
                {{ projectHealthLoading ? "Refreshing..." : "Refresh" }}
              </button>
            </div>
          </header>

          <p v-if="projectHealthError" class="project-health-error">{{ projectHealthError }}</p>

          <div v-if="projectHealthLoading && !projectHealth" class="project-health-loading">
            Reading project health...
          </div>

          <template v-else-if="projectHealth">
            <section
              v-if="projectHealthAttentionItems(projectHealth).length > 0"
              class="project-health-attention"
              aria-label="Health items needing attention"
            >
              <span>Needs attention</span>
              <ul>
                <li
                  v-for="item in projectHealthAttentionItems(projectHealth)"
                  :key="item.key"
                  :class="item.level"
                >
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.text }}</p>
                </li>
              </ul>
            </section>

            <div class="project-health-grid">
              <article class="project-health-card" :class="projectHealth.packageManager.status">
                <div class="project-health-card-heading">
                  <span>Package manager</span>
                  <strong>{{ healthStatusLabel(projectHealth.packageManager.status) }}</strong>
                </div>
                <dl>
                  <div>
                    <dt>Detected</dt>
                    <dd>{{ projectHealth.packageManager.detected ?? "Unknown" }}</dd>
                  </div>
                  <div>
                    <dt>Declared</dt>
                    <dd>{{ projectHealth.packageManager.declared ?? "None" }}</dd>
                  </div>
                  <div>
                    <dt>Lockfiles</dt>
                    <dd>{{ projectHealth.packageManager.lockfiles.join(", ") || "None" }}</dd>
                  </div>
                </dl>
                <ul v-if="projectHealth.packageManager.messages.length > 0" class="project-health-messages">
                  <li
                    v-for="entry in projectHealth.packageManager.messages"
                    :key="`package-${entry.text}`"
                    :class="entry.level"
                  >
                    {{ entry.text }}
                  </li>
                </ul>
              </article>

              <article class="project-health-card" :class="projectHealth.node.status">
                <div class="project-health-card-heading">
                  <span>Node</span>
                  <strong>{{ healthStatusLabel(projectHealth.node.status) }}</strong>
                </div>
                <dl>
                  <div>
                    <dt>Current</dt>
                    <dd>{{ projectHealth.node.current ?? "Unknown" }}</dd>
                  </div>
                  <div>
                    <dt>Configured</dt>
                    <dd>{{ projectHealth.node.configured ?? "None" }}</dd>
                  </div>
                  <div>
                    <dt>Engines</dt>
                    <dd>{{ projectHealth.node.engineRange ?? "None" }}</dd>
                  </div>
                </dl>
                <ul v-if="projectHealth.node.messages.length > 0" class="project-health-messages">
                  <li v-for="entry in projectHealth.node.messages" :key="`node-${entry.text}`" :class="entry.level">
                    {{ entry.text }}
                  </li>
                </ul>
              </article>

              <article class="project-health-card" :class="projectHealth.lockfile.status">
                <div class="project-health-card-heading">
                  <span>Lockfile</span>
                  <strong>{{ healthStatusLabel(projectHealth.lockfile.status) }}</strong>
                </div>
                <dl>
                  <div>
                    <dt>Present</dt>
                    <dd>{{ projectHealth.lockfile.present ? "Yes" : "No" }}</dd>
                  </div>
                  <div>
                    <dt>Dirty</dt>
                    <dd>{{ projectHealth.lockfile.dirty ? "Yes" : "No" }}</dd>
                  </div>
                  <div>
                    <dt>Stale</dt>
                    <dd>{{ projectHealth.lockfile.stale ? "Yes" : "No" }}</dd>
                  </div>
                </dl>
                <ul v-if="projectHealth.lockfile.messages.length > 0" class="project-health-messages">
                  <li
                    v-for="entry in projectHealth.lockfile.messages"
                    :key="`lockfile-${entry.text}`"
                    :class="entry.level"
                  >
                    {{ entry.text }}
                  </li>
                </ul>
              </article>

              <article class="project-health-card" :class="projectHealth.install.status">
                <div class="project-health-card-heading">
                  <span>Install state</span>
                  <strong>{{ healthStatusLabel(projectHealth.install.status) }}</strong>
                </div>
                <dl>
                  <div>
                    <dt>package.json</dt>
                    <dd>{{ projectHealth.packageJsonPresent ? "Found" : "Missing" }}</dd>
                  </div>
                  <div>
                    <dt>node_modules</dt>
                    <dd>{{ projectHealth.install.installed ? "Found" : "Missing" }}</dd>
                  </div>
                </dl>
                <ul v-if="projectHealth.install.messages.length > 0" class="project-health-messages">
                  <li
                    v-for="entry in projectHealth.install.messages"
                    :key="`install-${entry.text}`"
                    :class="entry.level"
                  >
                    {{ entry.text }}
                  </li>
                </ul>
              </article>
            </div>

            <section class="project-health-section">
              <div class="project-health-section-heading">
                <div>
                  <span>Dependencies</span>
                  <h4>{{ dependencyStatusLabel(projectHealth.dependencies) }}</h4>
                </div>
                <div class="project-health-section-actions">
                  <small v-if="projectHealth.dependencies.checkedAt">
                    Checked {{ healthCheckedAtLabel(projectHealth.dependencies.checkedAt) }}
                  </small>
                  <button
                    type="button"
                    class="secondary"
                    :disabled="projectOutdatedLoading || projectHealthLoading"
                    @click="checkOutdatedDependencies"
                  >
                    {{ projectOutdatedLoading ? "Checking..." : "Check outdated" }}
                  </button>
                </div>
              </div>
              <div class="project-health-check-row">
                <span>Status</span>
                <strong>{{ dependencyStatusLabel(projectHealth.dependencies) }}</strong>
                <small>{{ dependencyDetailLabel(projectHealth.dependencies) }}</small>
              </div>
              <div
                v-if="projectHealth.dependencies.outdated?.length"
                class="project-health-dependency-table"
                aria-label="Outdated dependencies"
              >
                <div
                  v-for="dependency in projectHealth.dependencies.outdated"
                  :key="dependency.name"
                  class="project-health-dependency-row"
                >
                  <div>
                    <strong>{{ dependency.name }}</strong>
                    <small v-if="dependency.type">{{ dependency.type }}</small>
                  </div>
                  <span>
                    {{ outdatedDependencyVersionLabel(dependency.current, dependency.wanted, dependency.latest) }}
                  </span>
                </div>
              </div>
              <p
                v-if="projectHealth.dependencies.error"
                class="project-health-error compact"
              >
                {{ projectHealth.dependencies.error }}
              </p>
            </section>

            <section class="project-health-section">
              <div class="project-health-section-heading">
                <div>
                  <span>Common scripts</span>
                  <h4>{{ availableProjectScripts(projectHealth).length }} available</h4>
                </div>
                <div class="project-health-section-actions">
                  <RunProjectScriptsButton
                    :health="projectHealth"
                    :loading="projectHealthLoading"
                    :script-terminals-by-script="scriptTerminalsByScript"
                    @run-script="$emit('runScript', $event)"
                    @restart-script="$emit('restartScript', $event)"
                  />
                </div>
              </div>

              <div v-if="availableProjectScripts(projectHealth).length > 0" class="project-health-script-table">
                <div
                  v-for="script in availableProjectScripts(projectHealth)"
                  :key="script.name"
                  class="project-health-script-row"
                  :class="projectScriptRuntimeStatus(script)"
                  role="button"
                  tabindex="0"
                  :title="projectScriptTerminal(script.name) ? 'Open terminal' : 'Run script'"
                  @click="openOrRunProjectScript(script)"
                  @keydown.enter="openOrRunProjectScript(script)"
                  @keydown.space.prevent="openOrRunProjectScript(script)"
                >
                  <div>
                    <strong>{{ script.name }}</strong>
                    <small>{{ script.command ?? "Missing from package.json" }}</small>
                  </div>
                  <span>{{ projectScriptRuntimeStatusLabel(script) }}</span>
                  <time>{{ scriptDurationLabel(script.durationMs) }}</time>
                  <p v-if="script.error">{{ script.error }}</p>
                </div>
              </div>
              <p v-else class="project-health-empty">No common scripts found.</p>
              <p v-if="missingProjectScriptSummary(projectHealth)" class="project-health-missing-summary">
                {{ missingProjectScriptSummary(projectHealth) }}
              </p>
            </section>
          </template>
        </section>
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
                  <li
                    v-for="(file, index) in selectedCommitDetails.files"
                    :key="`${file.status}-${file.path}`"
                  >
                    <button
                      type="button"
                      class="commit-file-button"
                      :class="{ active: activeCommitDiffSectionKey === commitDiffSectionKey(file, index) }"
                      :disabled="!commitDiffSectionKey(file, index)"
                      @click="scrollToCommitFile(file, index)"
                    >
                      <span class="commit-file-status">{{ file.status }}</span>
                      <span class="commit-file-path">
                        <strong>{{ file.path }}</strong>
                        <small v-if="file.originalPath">from {{ file.originalPath }}</small>
                      </span>
                      <code v-if="fileChangeSummary(file)">{{ fileChangeSummary(file) }}</code>
                    </button>
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
                <div v-if="selectedCommitDiffSections.length > 0" class="commit-diff-file-list">
                  <article
                    v-for="section in selectedCommitDiffSections"
                    :key="section.key"
                    :ref="(element) => setCommitDiffSectionRef(section.key, element)"
                    class="commit-diff-file"
                    :class="{ active: activeCommitDiffSectionKey === section.key }"
                  >
                    <div class="commit-diff-file-heading">
                      <strong>{{ section.path }}</strong>
                      <small v-if="section.originalPath">from {{ section.originalPath }}</small>
                    </div>
                    <pre class="status-diff-output commit-diff-output"><code><span
                      v-for="line in section.lines"
                      :key="line.key"
                      class="diff-line"
                      :class="line.className"
                    ><span class="diff-line-prefix">{{ line.prefix }}</span><span>{{ line.content }}</span></span></code></pre>
                  </article>
                </div>
                <p v-else class="commit-detail-empty compact">
                  No patch available for this commit.
                </p>
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
