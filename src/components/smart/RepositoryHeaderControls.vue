<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { RepositoryBranchLink } from "../../app-state";
import type { MergeLinkedSubmoduleBranchRequest, RepositoryDetails } from "../../repositories";
import { AppActionMenu, AppButton, AppDropdown, AppIcon, AppMenuItem } from "../ui";

const props = defineProps<{
  selectedDetails: RepositoryDetails | null;
  isDetailLoading: boolean;
  autoRefreshLabel: string;
  autoRefreshProgress: number;
  commitCelebrations: boolean;
  syncCelebrationToken: number;
  syncShortcutLabel: string;
  syncingBranchName: string | null;
  deletingBranchName: string | null;
  deletingSubmoduleBranchName: string | null;
  checkingOutBranchName: string | null;
  mergingLinkedBranchName: string | null;
  branchFeedbackMessages: Record<string, string>;
  repositoryBranchLinks: RepositoryBranchLink[];
}>();

const emit = defineEmits<{
  back: [];
  refresh: [];
  deleteBranch: [branchName: string];
  deleteSubmoduleBranch: [submodulePath: string, branchName: string];
  checkoutBranch: [branchName: string];
  checkoutRemoteBranch: [remoteBranchName: string];
  syncBranch: [branchName: string];
  saveRepositoryBranchLink: [link: Omit<RepositoryBranchLink, "updatedAt">];
  removeRepositoryBranchLink: [link: Pick<RepositoryBranchLink, "repoPath" | "parentBranch" | "submodulePath">];
  mergeLinkedSubmoduleBranch: [request: Omit<MergeLinkedSubmoduleBranchRequest, "repoPath">];
  copyPath: [repoPath: string];
  openInEditor: [repoPath: string];
  openInFileManager: [repoPath: string];
  openInTerminal: [repoPath: string];
}>();

const branchFilter = ref("all");
const branchSearchQuery = ref("");
const selectedRemoteBranchName = ref("");
const selectedSubmodulePath = ref("");
const targetParentBranchName = ref("");
const targetSubmoduleBranchName = ref("");
const isBranchMenuOpen = ref(false);
const isSubmoduleLinkManagerOpen = ref(false);
const isSubmoduleBranchManagerOpen = ref(false);
const refreshButtonElement = ref<HTMLElement | null>(null);
const isRefreshIconSettling = ref(false);
const syncConfettiBursts = ref<Array<{ id: number }>>([]);
const refreshIconStartAngle = ref(0);
const refreshIconEndAngle = ref(0);
const refreshIconSettleDuration = ref(0);
let refreshIconSettleTimer: number | undefined;
let nextSyncConfettiBurstId = 0;
const syncConfettiTimers = new Set<number>();

const branchFilters = [
  { key: "all", label: "All" },
  { key: "behind", label: "Behind" },
  { key: "ahead", label: "Ahead" },
  { key: "no-upstream", label: "No upstream" },
  { key: "in-sync", label: "In sync" },
] as const;

type BranchFilterKey = (typeof branchFilters)[number]["key"];

const sortedBranches = computed(() => {
  const branches = props.selectedDetails?.gitBranches ?? [];

  return [...branches].sort((branchA, branchB) => {
    if (branchA.current !== branchB.current) {
      return branchA.current ? -1 : 1;
    }

    return branchA.name.localeCompare(branchB.name);
  });
});

const normalizedBranchSearchQuery = computed(() => branchSearchQuery.value.trim().toLowerCase());

const branchesMatchingSearch = computed(() =>
  sortedBranches.value.filter((branch) => branchMatchesSearch(branch, normalizedBranchSearchQuery.value)),
);

const branchFilterOptions = computed(() =>
  branchFilters.map((filter) => ({
    ...filter,
    count: branchesMatchingSearch.value.filter((branch) => branchMatchesFilter(branch, filter.key)).length,
  })),
);

const filteredBranches = computed(() =>
  branchesMatchingSearch.value.filter((branch) =>
    branchMatchesFilter(branch, branchFilter.value as BranchFilterKey),
  ),
);

const remoteBranchesToCreate = computed(() =>
  [...(props.selectedDetails?.gitRemoteBranches ?? [])]
    .filter((branch) => !branch.hasLocalBranch)
    .sort((branchA, branchB) => branchA.localName.localeCompare(branchB.localName)),
);

const remoteBranchOptions = computed(() =>
  remoteBranchesToCreate.value.map((branch) => ({
    label: branch.name,
    value: branch.name,
  })),
);
const submoduleOptions = computed(() =>
  (props.selectedDetails?.gitSubmodules ?? []).map((submodule) => ({
    label: `${submodule.path} (${submodule.branch})`,
    value: submodule.path,
  })),
);
const selectedSubmodule = computed(() =>
  props.selectedDetails?.gitSubmodules.find((submodule) => submodule.path === selectedSubmodulePath.value),
);
const currentBranch = computed(() =>
  props.selectedDetails?.gitBranches.find((branch) => branch.current),
);
const savedLinksForSelectedRepository = computed(() => {
  const repoPath = props.selectedDetails?.path;

  if (!repoPath) {
    return [];
  }

  return props.repositoryBranchLinks.filter((link) => link.repoPath === repoPath);
});
const currentBranchSubmoduleLink = computed(() => {
  if (!props.selectedDetails || !selectedSubmodulePath.value) {
    return undefined;
  }

  return findSavedSubmoduleLink(props.selectedDetails.branch);
});
const currentSubmoduleLinkLabel = computed(() =>
  currentBranchSubmoduleLink.value
    ? `${currentBranchSubmoduleLink.value.parentBranch} -> ${currentBranchSubmoduleLink.value.submoduleBranch}`
    : "No link for current branch",
);
const submoduleLinkDropdownOptions = computed(() => [
  { label: "No link", value: "" },
  ...(selectedSubmodule.value?.branches ?? []).map((branch) => ({
    label: branch.name,
    value: branch.name,
  })),
]);
const submoduleLinkTableRows = computed(() =>
  sortedBranches.value.map((branch) => {
    const savedSubmoduleBranch = findSavedSubmoduleLink(branch.name)?.submoduleBranch ?? "";
    const submoduleBranchExists = submoduleLinkDropdownOptions.value.some((option) =>
      option.value === savedSubmoduleBranch
    );

    return {
      current: branch.current,
      parentBranch: branch.name,
      submoduleBranch: submoduleBranchExists ? savedSubmoduleBranch : "",
    };
  }),
);
const linkedSubmoduleBranchCount = computed(() =>
  submoduleLinkTableRows.value.filter((row) => row.submoduleBranch).length,
);
const targetParentBranchOptions = computed(() =>
  sortedBranches.value
    .filter((branch) => !branch.current)
    .map((branch) => ({
      label: branch.name,
      value: branch.name,
    })),
);
const targetSubmoduleBranchOptions = computed(() =>
  (selectedSubmodule.value?.branches ?? [])
    .filter((branch) => branch.name !== selectedSubmodule.value?.branch)
    .map((branch) => ({
      label: branch.name,
      value: branch.name,
    })),
);
const linkedSubmoduleRouteLabel = computed(() => {
  if (!props.selectedDetails || !selectedSubmodule.value) {
    return "";
  }

  return [
    `${props.selectedDetails.branch} -> ${targetParentBranchName.value || "target"}`,
    `${selectedSubmodule.value.branch} -> ${targetSubmoduleBranchName.value || "target"}`,
  ].join(" | ");
});
const linkedBranchMergeDisabledReason = computed(() => {
  if (!props.selectedDetails) {
    return "No repository selected.";
  }

  if (!selectedSubmodule.value) {
    return "Choose a submodule.";
  }

  if (!currentBranch.value) {
    return "No current parent branch was found.";
  }

  if (props.selectedDetails.gitStatus.conflicted.length > 0 || !props.selectedDetails.gitStatus.clean) {
    return "Commit, stash, or discard parent repository changes before merging.";
  }

  if (selectedSubmodule.value.dirty) {
    return "Commit, stash, or discard submodule changes before merging.";
  }

  if (!targetParentBranchName.value || !targetSubmoduleBranchName.value) {
    return "Choose target branches.";
  }

  if (targetParentBranchName.value === props.selectedDetails.branch) {
    return "Choose a different parent target branch.";
  }

  if (targetSubmoduleBranchName.value === selectedSubmodule.value.branch) {
    return "Choose a different submodule target branch.";
  }

  if (props.mergingLinkedBranchName) {
    return "Linked branch merge is already running.";
  }

  return "";
});
const currentBranchSyncLabel = computed(() =>
  currentBranch.value ? branchSyncLabel(currentBranch.value) : "No branch details",
);
const branchMenuLabel = computed(() => {
  if (!props.selectedDetails) {
    return "Manage branches";
  }

  return `Manage branches. Current branch ${props.selectedDetails.branch}. ${currentBranchSyncLabel.value}.`;
});
const changedFileCount = computed(() => {
  const gitStatus = props.selectedDetails?.gitStatus;

  if (!gitStatus) {
    return 0;
  }

  return (
    gitStatus.staged.length +
    gitStatus.unstaged.length +
    gitStatus.untracked.length +
    gitStatus.conflicted.length
  );
});
const changedFileLabel = computed(() => {
  if (!props.selectedDetails) {
    return "";
  }

  if (changedFileCount.value === 0) {
    return "Clean tree";
  }

  return changedFileCount.value === 1 ? "1 changed file" : `${changedFileCount.value} changed files`;
});
const scriptCountLabel = computed(() => {
  const count = props.selectedDetails?.npmScriptCount ?? 0;

  return count === 1 ? "1 script" : `${count} scripts`;
});

watch(
  () => props.selectedDetails?.path,
  () => {
    branchSearchQuery.value = "";
    selectedRemoteBranchName.value = "";
    selectedSubmodulePath.value = "";
    targetParentBranchName.value = "";
    targetSubmoduleBranchName.value = "";
    isSubmoduleLinkManagerOpen.value = false;
    isSubmoduleBranchManagerOpen.value = false;
    isBranchMenuOpen.value = false;
  },
);

watch(
  selectedSubmodulePath,
  () => {
    isSubmoduleLinkManagerOpen.value = false;
    isSubmoduleBranchManagerOpen.value = false;
  },
);

watch(
  remoteBranchesToCreate,
  (branches) => {
    if (!branches.some((branch) => branch.name === selectedRemoteBranchName.value)) {
      selectedRemoteBranchName.value = branches[0]?.name ?? "";
    }
  },
  { immediate: true },
);

watch(
  submoduleOptions,
  (options) => {
    if (!options.some((option) => option.value === selectedSubmodulePath.value)) {
      selectedSubmodulePath.value = options[0]?.value ?? "";
    }
  },
  { immediate: true },
);

watch(
  [selectedSubmodule, currentBranch, savedLinksForSelectedRepository],
  () => {
    if (!props.selectedDetails || !selectedSubmodule.value) {
      targetParentBranchName.value = "";
      targetSubmoduleBranchName.value = "";
      return;
    }

    const inferredParentBranch = inferNextNumberedBranch(
      props.selectedDetails.branch,
      props.selectedDetails.gitBranches.map((branch) => branch.name),
    );

    if (!targetParentBranchName.value || targetParentBranchName.value === props.selectedDetails.branch) {
      targetParentBranchName.value = inferredParentBranch || targetParentBranchOptions.value[0]?.value || "";
    }

    if (!targetSubmoduleBranchName.value || targetSubmoduleBranchName.value === selectedSubmodule.value.branch) {
      targetSubmoduleBranchName.value =
        findSavedTargetSubmoduleBranch(targetParentBranchName.value) ||
        inferNextNumberedBranch(
          selectedSubmodule.value.branch,
          selectedSubmodule.value.branches.map((branch) => branch.name),
        ) ||
        targetSubmoduleBranchOptions.value[0]?.value ||
        "";
    }
  },
  { immediate: true },
);

watch(
  targetParentBranchName,
  (parentBranchName) => {
    const linkedSubmoduleBranch = findSavedTargetSubmoduleBranch(parentBranchName);

    if (linkedSubmoduleBranch) {
      targetSubmoduleBranchName.value = linkedSubmoduleBranch;
    }
  },
);

function currentRefreshIconAngle() {
  const iconElement = refreshButtonElement.value?.querySelector<HTMLElement>(".button-icon");

  if (!iconElement) {
    return 0;
  }

  const transform = window.getComputedStyle(iconElement).transform;

  if (!transform || transform === "none") {
    return 0;
  }

  const matrix = new DOMMatrixReadOnly(transform);
  const angle = Math.atan2(matrix.b, matrix.a) * (180 / Math.PI);

  return (angle + 360) % 360;
}

function branchMatchesSearch(
  branch: RepositoryDetails["gitBranches"][number],
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return true;
  }

  return [branch.name, branch.upstream ?? ""].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

function branchMatchesFilter(
  branch: RepositoryDetails["gitBranches"][number],
  filterKey: BranchFilterKey,
) {
  if (filterKey === "behind") {
    return branch.behind > 0;
  }

  if (filterKey === "ahead") {
    return branch.ahead > 0;
  }

  if (filterKey === "no-upstream") {
    return !branch.upstream;
  }

  if (filterKey === "in-sync") {
    return branch.inSyncWithRemote;
  }

  return true;
}

function inferNextNumberedBranch(currentBranchName: string, branchNames: string[]) {
  const match = currentBranchName.match(/^(.*?)(\d+)$/);

  if (!match) {
    return "";
  }

  const [, prefix, numberText] = match;
  const nextNumber = String(Number(numberText) + 1).padStart(numberText.length, "0");
  const nextBranchName = `${prefix}${nextNumber}`;

  return branchNames.includes(nextBranchName) ? nextBranchName : "";
}

function findSavedSubmoduleLink(parentBranch: string) {
  if (!selectedSubmodulePath.value) {
    return undefined;
  }

  return savedLinksForSelectedRepository.value.find((link) =>
    link.parentBranch === parentBranch &&
    link.submodulePath === selectedSubmodulePath.value
  );
}

function findSavedTargetSubmoduleBranch(parentBranch: string) {
  const linkedSubmoduleBranch = findSavedSubmoduleLink(parentBranch)?.submoduleBranch;

  if (!linkedSubmoduleBranch) {
    return "";
  }

  return targetSubmoduleBranchOptions.value.some((option) => option.value === linkedSubmoduleBranch)
    ? linkedSubmoduleBranch
    : "";
}

function updateSubmoduleBranchLink(parentBranch: string, submoduleBranchValue: string | number) {
  if (!props.selectedDetails || !selectedSubmodule.value) {
    return;
  }

  const submoduleBranch = String(submoduleBranchValue);

  if (!submoduleBranch) {
    emit("removeRepositoryBranchLink", {
      repoPath: props.selectedDetails.path,
      parentBranch,
      submodulePath: selectedSubmodule.value.path,
    });
    return;
  }

  emit("saveRepositoryBranchLink", {
    repoPath: props.selectedDetails.path,
    parentBranch,
    submodulePath: selectedSubmodule.value.path,
    submoduleBranch,
  });

  if (parentBranch === targetParentBranchName.value) {
    targetSubmoduleBranchName.value = submoduleBranch;
  }
}

function closeBranchMenu() {
  isSubmoduleLinkManagerOpen.value = false;
  isBranchMenuOpen.value = false;
}

function mergeLinkedBranches() {
  if (!props.selectedDetails || !selectedSubmodule.value || linkedBranchMergeDisabledReason.value) {
    return;
  }

  emit("mergeLinkedSubmoduleBranch", {
    sourceParentBranch: props.selectedDetails.branch,
    targetParentBranch: targetParentBranchName.value,
    submodulePath: selectedSubmodule.value.path,
    sourceSubmoduleBranch: selectedSubmodule.value.branch,
    targetSubmoduleBranch: targetSubmoduleBranchName.value,
  });
}

function isDeletingSubmoduleBranch(submodulePath: string, branchName: string) {
  return props.deletingSubmoduleBranchName === `${submodulePath}:${branchName}`;
}

function clearBranchSearch() {
  branchSearchQuery.value = "";
}

function prepareRefreshIconSettle() {
  const startAngle = currentRefreshIconAngle();
  const remainingAngle = startAngle === 0 ? 0 : 360 - startAngle;

  refreshIconStartAngle.value = startAngle;
  refreshIconEndAngle.value = remainingAngle === 0 ? 0 : 360;
  refreshIconSettleDuration.value = Math.round((remainingAngle / 360) * 900);
}

watch(
  () => props.isDetailLoading,
  (isDetailLoading, wasDetailLoading) => {
    if (refreshIconSettleTimer !== undefined) {
      window.clearTimeout(refreshIconSettleTimer);
      refreshIconSettleTimer = undefined;
    }

    if (isDetailLoading) {
      isRefreshIconSettling.value = false;
      return;
    }

    if (wasDetailLoading) {
      prepareRefreshIconSettle();
      isRefreshIconSettling.value = true;
      refreshIconSettleTimer = window.setTimeout(() => {
        isRefreshIconSettling.value = false;
        refreshIconSettleTimer = undefined;
      }, refreshIconSettleDuration.value);
    }
  },
);

watch(
  () => props.syncCelebrationToken,
  (syncCelebrationToken) => {
    if (syncCelebrationToken > 0) {
      triggerSyncConfetti();
    }
  },
);

function triggerSyncConfetti() {
  if (!props.commitCelebrations) {
    return;
  }

  const id = nextSyncConfettiBurstId++;
  syncConfettiBursts.value = [...syncConfettiBursts.value, { id }];

  const timer = window.setTimeout(() => {
    syncConfettiBursts.value = syncConfettiBursts.value.filter((burst) => burst.id !== id);
    syncConfettiTimers.delete(timer);
  }, 1200);

  syncConfettiTimers.add(timer);
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

function isBranchSyncActionReady(
  branch: RepositoryDetails["gitBranches"][number],
  gitStatus: RepositoryDetails["gitStatus"],
) {
  return !branch.inSyncWithRemote && !branchSyncDisabledReason(branch, gitStatus);
}

function isDeletingBranch(branchName: string, deletingBranchName: string | null) {
  return deletingBranchName === branchName;
}

function isCheckingOutBranch(branchName: string, checkingOutBranchName: string | null) {
  return checkingOutBranchName === branchName;
}

function branchCheckoutDisabledReason(gitStatus: RepositoryDetails["gitStatus"]) {
  return gitStatus.clean
    ? undefined
    : "Commit, stash, or discard working tree changes before switching branches.";
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

function branchSyncActionIcon(
  branch: RepositoryDetails["gitBranches"][number],
  syncingBranchName: string | null,
) {
  if (isSyncingBranch(branch.name, syncingBranchName)) {
    return "restart";
  }

  if (branch.ahead > 0 && branch.behind === 0) {
    return "push";
  }

  if (branch.behind > 0 && branch.ahead === 0) {
    return "pull";
  }

  return "restart";
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

function checkoutSelectedRemoteBranch() {
  if (!selectedRemoteBranchName.value) {
    return;
  }

  emit("checkoutRemoteBranch", selectedRemoteBranchName.value);
}

onBeforeUnmount(() => {
  if (refreshIconSettleTimer !== undefined) {
    window.clearTimeout(refreshIconSettleTimer);
  }

  syncConfettiTimers.forEach((timer) => window.clearTimeout(timer));
  syncConfettiTimers.clear();
});
</script>

<template>
  <div class="detail-command-bar">
    <nav class="detail-nav" aria-label="Repository detail navigation">
      <AppButton variant="secondary" icon="arrow-left" class="detail-back-button" @click="$emit('back')">
        Back
      </AppButton>

      <div v-if="selectedDetails" class="detail-context-pills" aria-label="Repository state">
        <div class="detail-state-summary" aria-label="Repository summary">
          <span class="detail-state-item" :class="{ warning: changedFileCount > 0 }">
            {{ changedFileLabel }}
          </span>
          <span class="detail-state-item">{{ scriptCountLabel }}</span>
        </div>
      </div>
    </nav>

    <div v-if="selectedDetails" class="detail-repository-tools" aria-label="Repository actions">
      <div class="branch-menu">
        <div class="branch-menu-combo">
          <button
            type="button"
            class="secondary branch-menu-trigger"
            :aria-label="branchMenuLabel"
            :aria-expanded="isBranchMenuOpen"
            aria-controls="branch-management-menu"
            :title="branchMenuLabel"
            @click="isBranchMenuOpen = !isBranchMenuOpen"
          >
            <AppIcon name="repository" class="branch-menu-icon" />
            <span class="branch-menu-summary">
              <span class="branch-menu-kicker">Branch</span>
              <span class="branch-menu-title-row">
                <strong>{{ selectedDetails.branch }}</strong>
              </span>
              <span class="branch-menu-meta">{{ currentBranchSyncLabel }}</span>
            </span>
            <span class="panel-count">{{ selectedDetails.gitBranches.length }}</span>
          </button>
          <button
            v-if="currentBranch"
            type="button"
            class="secondary branch-menu-sync-button"
            :class="{
              active:
                commitCelebrations &&
                isBranchSyncActionReady(currentBranch, selectedDetails.gitStatus),
              pending: isSyncingBranch(currentBranch.name, syncingBranchName),
            }"
            :disabled="
              Boolean(branchSyncDisabledReason(currentBranch, selectedDetails.gitStatus)) ||
              Boolean(syncingBranchName) ||
              Boolean(deletingBranchName)
            "
            :title="branchSyncTitle(currentBranch, selectedDetails.gitStatus, syncingBranchName)"
            :aria-busy="isSyncingBranch(currentBranch.name, syncingBranchName)"
            :aria-label="`${branchSyncActionLabel(currentBranch)} current branch ${currentBranch.name}`"
            @click="$emit('syncBranch', currentBranch.name)"
          >
            <AppIcon
              :name="branchSyncActionIcon(currentBranch, syncingBranchName)"
              class="button-icon"
            />
            <span class="branch-menu-sync-text">Sync</span>
            <kbd class="shortcut-label branch-menu-sync-shortcut">{{ syncShortcutLabel }}</kbd>
            <span class="visually-hidden">{{ branchSyncActionLabel(currentBranch) }}</span>
          </button>
          <div
            v-for="burst in syncConfettiBursts"
            :key="burst.id"
            class="commit-confetti branch-sync-confetti"
            aria-hidden="true"
          >
            <span v-for="index in 18" :key="index"></span>
          </div>
        </div>

        <Teleport to="body">
          <div
            v-if="isBranchMenuOpen"
            class="modal-backdrop branch-menu-modal-backdrop"
            role="presentation"
            @click.self="closeBranchMenu"
          >
            <section
              id="branch-management-menu"
              class="branch-menu-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="branch-management-title"
              @keydown.esc.stop.prevent="closeBranchMenu"
            >
            <div class="panel-heading branch-menu-heading">
              <div>
                <h3 id="branch-management-title">Branch management</h3>
                <span class="panel-subtitle">{{ selectedDetails.name }} - {{ selectedDetails.branch }}</span>
              </div>
              <div class="branch-menu-heading-stats" aria-label="Branch counts">
                <span>{{ selectedDetails.gitBranches.length }} local</span>
                <span>{{ remoteBranchesToCreate.length }} remote new</span>
                <span v-if="selectedDetails.gitSubmodules.length > 0">
                  {{ selectedDetails.gitSubmodules.length }} submodule
                </span>
              </div>
              <AppButton
                variant="secondary"
                size="icon"
                icon="close"
                class="branch-menu-close"
                aria-label="Close branch menu"
                title="Close"
                @click="closeBranchMenu"
              >
                Close
              </AppButton>
            </div>

            <div class="branch-menu-layout">
              <div class="branch-menu-side">
                <div class="branch-menu-section-heading">
                  <div>
                    <h4>Current branch</h4>
                    <span>{{ currentBranchSyncLabel }}</span>
                  </div>
                </div>

                <section
                  v-if="currentBranch"
                  class="current-branch-action-card"
                  aria-label="Current branch sync action"
                >
                  <div class="current-branch-action-copy">
                    <span class="current-branch-action-kicker">Checked out</span>
                    <strong>{{ currentBranch.name }}</strong>
                    <small>{{ currentBranch.upstream ?? "No upstream configured" }}</small>
                  </div>
                  <AppButton
                    v-if="!currentBranch.inSyncWithRemote"
                    :icon="branchSyncActionIcon(currentBranch, syncingBranchName)"
                    class="branch-primary-action"
                    :class="{ pending: isSyncingBranch(currentBranch.name, syncingBranchName) }"
                    :disabled="
                      Boolean(branchSyncDisabledReason(currentBranch, selectedDetails.gitStatus)) ||
                      Boolean(syncingBranchName) ||
                      Boolean(deletingBranchName)
                    "
                    :title="branchSyncTitle(currentBranch, selectedDetails.gitStatus, syncingBranchName)"
                    :aria-busy="isSyncingBranch(currentBranch.name, syncingBranchName)"
                    @click="$emit('syncBranch', currentBranch.name)"
                  >
                    <span>
                      {{
                        isSyncingBranch(currentBranch.name, syncingBranchName)
                          ? `${branchSyncActionLabel(currentBranch)}ing...`
                          : branchSyncActionLabel(currentBranch)
                      }}
                    </span>
                  </AppButton>
                  <span v-else class="branch-sync synced">In sync</span>
                  <p v-if="branchFeedbackMessages[currentBranch.name]" class="branch-feedback">
                    {{ branchFeedbackMessages[currentBranch.name] }}
                  </p>
                  <p
                    v-else-if="
                      !currentBranch.inSyncWithRemote &&
                      branchSyncDisabledReason(currentBranch, selectedDetails.gitStatus)
                    "
                    class="branch-safety"
                  >
                    {{ branchSyncDisabledReason(currentBranch, selectedDetails.gitStatus) }}
                  </p>
                </section>

                <section
                  v-if="selectedDetails.gitSubmodules.length > 0"
                  class="linked-submodule-branch-card"
                  :class="{ 'local-branch-manager-open': isSubmoduleBranchManagerOpen }"
                  aria-label="Linked submodule branches"
                >
                  <div class="branch-menu-section-heading">
                    <div>
                      <h4>Linked submodule</h4>
                      <span>{{ selectedSubmodule?.branch ?? "No submodule selected" }}</span>
                    </div>
                  </div>

                  <div class="linked-submodule-link-group">
                    <div class="linked-submodule-grid compact">
                      <label for="linked-submodule-select">Submodule</label>
                      <AppDropdown
                        id="linked-submodule-select"
                        v-model="selectedSubmodulePath"
                        menu-class="remote-branch-dropdown-menu"
                        :options="submoduleOptions"
                      />
                    </div>

                    <div class="linked-submodule-row">
                      <div class="linked-submodule-summary">
                        <span class="current-branch-action-kicker">Branch links</span>
                        <strong>{{ linkedSubmoduleBranchCount }} saved</strong>
                        <small>{{ currentSubmoduleLinkLabel }}</small>
                      </div>
                      <div class="linked-submodule-actions">
                        <AppButton
                          variant="secondary"
                          icon="link"
                          class="branch-action"
                          :active="isSubmoduleLinkManagerOpen"
                          :disabled="!selectedSubmodule"
                          :aria-expanded="isSubmoduleLinkManagerOpen"
                          aria-haspopup="dialog"
                          aria-controls="submodule-branch-link-modal"
                          title="Manage repository to submodule branch links"
                          @click="isSubmoduleLinkManagerOpen = !isSubmoduleLinkManagerOpen"
                        >
                          Manage
                        </AppButton>
                      </div>
                    </div>
                  </div>

                  <div class="linked-submodule-merge-group">
                    <div class="linked-submodule-grid">
                      <label for="target-parent-branch-select">Repository target</label>
                      <AppDropdown
                        id="target-parent-branch-select"
                        v-model="targetParentBranchName"
                        menu-class="remote-branch-dropdown-menu"
                        :options="targetParentBranchOptions"
                      />

                      <label for="target-submodule-branch-select">Submodule target</label>
                      <AppDropdown
                        id="target-submodule-branch-select"
                        v-model="targetSubmoduleBranchName"
                        menu-class="remote-branch-dropdown-menu"
                        :options="targetSubmoduleBranchOptions"
                      />
                    </div>

                    <AppButton
                      icon="merge"
                      class="branch-primary-action linked-submodule-merge"
                      :class="{ pending: Boolean(mergingLinkedBranchName) }"
                      :disabled="Boolean(linkedBranchMergeDisabledReason)"
                      :title="linkedBranchMergeDisabledReason || linkedSubmoduleRouteLabel || 'Merge linked branches into target branches'"
                      @click="mergeLinkedBranches"
                    >
                      <span>
                        {{
                          mergingLinkedBranchName
                            ? `Merging into ${mergingLinkedBranchName}...`
                            : "Merge down"
                        }}
                      </span>
                    </AppButton>
                  </div>
                  <p v-if="!selectedSubmodule && linkedBranchMergeDisabledReason" class="branch-safety">
                    {{ linkedBranchMergeDisabledReason }}
                  </p>

                  <div
                    v-if="selectedSubmodule"
                    class="submodule-branch-controls"
                    :class="{ open: isSubmoduleBranchManagerOpen }"
                  >
                    <div class="submodule-branch-heading">
                      <div>
                        <span class="current-branch-action-kicker">Local branches</span>
                        <small>Clean up local-only branches.</small>
                      </div>
                      <span>{{ selectedSubmodule.branches.length }}</span>
                      <AppButton
                        variant="secondary"
                        class="submodule-branch-toggle"
                        :active="isSubmoduleBranchManagerOpen"
                        :aria-expanded="isSubmoduleBranchManagerOpen"
                        aria-controls="submodule-local-branches"
                        @click="isSubmoduleBranchManagerOpen = !isSubmoduleBranchManagerOpen"
                      >
                        {{ isSubmoduleBranchManagerOpen ? "Hide" : "Manage" }}
                      </AppButton>
                    </div>

                    <ul
                      v-if="isSubmoduleBranchManagerOpen && selectedSubmodule.branches.length > 0"
                      id="submodule-local-branches"
                      class="submodule-branch-list"
                    >
                      <li
                        v-for="branch in selectedSubmodule.branches"
                        :key="`${selectedSubmodule.path}:${branch.name}`"
                        :class="{ current: branch.current }"
                      >
                        <div>
                          <strong>{{ branch.name }}</strong>
                          <small>{{ branch.current ? "Current branch" : "Local branch" }}</small>
                        </div>
                        <AppActionMenu
                          v-if="!branch.current"
                          :label="`More actions for submodule branch ${branch.name}`"
                        >
                          <AppMenuItem
                            icon="trash"
                            tone="danger"
                            :class="{ pending: isDeletingSubmoduleBranch(selectedSubmodule.path, branch.name) }"
                            :disabled="
                              !branch.canDelete ||
                              Boolean(deletingSubmoduleBranchName) ||
                              Boolean(mergingLinkedBranchName)
                            "
                            :title="branch.deleteReason ?? 'Remove local submodule branch'"
                            @click="$emit('deleteSubmoduleBranch', selectedSubmodule.path, branch.name)"
                          >
                            {{
                              isDeletingSubmoduleBranch(selectedSubmodule.path, branch.name)
                                ? "Removing..."
                                : "Remove local branch"
                            }}
                          </AppMenuItem>
                        </AppActionMenu>
                      </li>
                    </ul>
                    <p
                      v-else-if="isSubmoduleBranchManagerOpen"
                      id="submodule-local-branches"
                      class="branch-empty-state"
                    >
                      No local branches found for this submodule.
                    </p>
                  </div>
                </section>
              </div>

              <div class="branch-menu-main">
                <div class="git-branches">
                  <div class="branch-list-toolbar">
                    <div class="branch-menu-section-heading branch-list-heading">
                      <div>
                      <h4>Repository branches</h4>
                        <span>
                          {{ filteredBranches.length }} shown
                          <template v-if="normalizedBranchSearchQuery">
                            from {{ branchesMatchingSearch.length }} matches
                          </template>
                        </span>
                      </div>
                    </div>

                    <label class="branch-search-control">
                      <span>Search branches</span>
                      <div class="branch-search-input">
                        <input
                          v-model="branchSearchQuery"
                          type="search"
                          placeholder="Branch or upstream"
                          autocomplete="off"
                        />
                        <AppButton
                          v-if="branchSearchQuery"
                          variant="secondary"
                          size="icon"
                          icon="close"
                          class="branch-search-clear"
                          aria-label="Clear branch search"
                          title="Clear search"
                          @click="clearBranchSearch"
                        >
                          Clear search
                        </AppButton>
                      </div>
                    </label>

                    <form
                      v-if="remoteBranchesToCreate.length > 0"
                      class="remote-branch-checkout"
                      @submit.prevent="checkoutSelectedRemoteBranch"
                    >
                      <label for="remote-branch-select">
                        Create from remote
                      </label>
                      <div class="remote-branch-create-row">
                        <AppDropdown
                          id="remote-branch-select"
                          v-model="selectedRemoteBranchName"
                          menu-class="remote-branch-dropdown-menu"
                          :options="remoteBranchOptions"
                          :disabled="
                            Boolean(checkingOutBranchName) ||
                            Boolean(syncingBranchName) ||
                            Boolean(deletingBranchName) ||
                            Boolean(branchCheckoutDisabledReason(selectedDetails.gitStatus))
                          "
                        />
                        <AppButton
                          type="submit"
                          variant="secondary"
                          class="branch-action"
                          :disabled="
                            !selectedRemoteBranchName ||
                            Boolean(checkingOutBranchName) ||
                            Boolean(syncingBranchName) ||
                            Boolean(deletingBranchName) ||
                            Boolean(branchCheckoutDisabledReason(selectedDetails.gitStatus))
                          "
                          :title="branchCheckoutDisabledReason(selectedDetails.gitStatus) ?? 'Create and check out a local tracking branch'"
                        >
                          {{
                            checkingOutBranchName === selectedRemoteBranchName
                              ? "Creating..."
                              : "Create"
                          }}
                        </AppButton>
                      </div>
                    </form>

                    <div class="branch-filters" aria-label="Branch filters">
                      <AppButton
                        v-for="filter in branchFilterOptions"
                        :key="filter.key"
                        type="button"
                        variant="secondary"
                        :active="branchFilter === filter.key"
                        @click="branchFilter = filter.key"
                      >
                        <span>{{ filter.label }}</span>
                        <span class="branch-filter-count">{{ filter.count }}</span>
                      </AppButton>
                    </div>
                  </div>

                  <p v-if="syncingBranchName" class="branch-pending">
                    Syncing {{ syncingBranchName }}...
                  </p>
                  <p v-else-if="checkingOutBranchName" class="branch-pending">
                    Switching to {{ checkingOutBranchName }}...
                  </p>

                  <ul v-if="filteredBranches.length > 0" class="git-branch-list">
                    <li
                      v-for="branch in filteredBranches"
                      :key="branch.name"
                      :class="{ current: branch.current }"
                    >
                      <div>
                        <span class="branch-row-title">
                          <strong>{{ branch.name }}</strong>
                          <small v-if="branch.current" class="branch-current-marker">Current</small>
                        </span>
                        <small>
                          {{ branch.upstream ?? "No upstream" }}
                        </small>
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
                        <AppButton
                          v-if="!branch.current"
                          variant="secondary"
                          class="branch-action"
                          :class="{ pending: isCheckingOutBranch(branch.name, checkingOutBranchName) }"
                          :disabled="
                            Boolean(branchCheckoutDisabledReason(selectedDetails.gitStatus)) ||
                            Boolean(checkingOutBranchName) ||
                            Boolean(syncingBranchName) ||
                            Boolean(deletingBranchName)
                          "
                          :title="branchCheckoutDisabledReason(selectedDetails.gitStatus) ?? 'Switch to this local branch'"
                          @click="$emit('checkoutBranch', branch.name)"
                        >
                          {{ isCheckingOutBranch(branch.name, checkingOutBranchName) ? "Switching..." : "Switch" }}
                        </AppButton>
                        <AppActionMenu
                          v-if="!branch.inSyncWithRemote || !branch.current"
                          :label="`More actions for ${branch.name}`"
                        >
                          <AppMenuItem
                            v-if="!branch.inSyncWithRemote"
                            icon="restart"
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
                          </AppMenuItem>
                          <AppMenuItem
                            v-if="!branch.current"
                            icon="trash"
                            tone="danger"
                            :class="{ pending: isDeletingBranch(branch.name, deletingBranchName) }"
                            :disabled="
                              !branch.canDelete || Boolean(syncingBranchName) || Boolean(deletingBranchName)
                            "
                            :title="branch.deleteReason ?? 'Delete local branch'"
                            @click="$emit('deleteBranch', branch.name)"
                          >
                            {{ isDeletingBranch(branch.name, deletingBranchName) ? "Removing..." : "Remove branch" }}
                          </AppMenuItem>
                        </AppActionMenu>
                      </div>
                    </li>
                  </ul>

                  <p v-else>No branches match this filter.</p>
                </div>
              </div>
            </div>
            </section>
          </div>
        </Teleport>

        <Teleport to="body">
          <div
            v-if="isSubmoduleLinkManagerOpen && selectedSubmodule"
            class="modal-backdrop submodule-link-modal-backdrop"
            role="presentation"
            @click.self="isSubmoduleLinkManagerOpen = false"
          >
            <section
              id="submodule-branch-link-modal"
              class="submodule-link-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="submodule-branch-link-title"
              @keydown.esc.stop.prevent="isSubmoduleLinkManagerOpen = false"
            >
              <div class="panel-heading submodule-link-modal-heading">
                <div>
                  <h3 id="submodule-branch-link-title">Branch links</h3>
                  <span class="panel-subtitle">{{ selectedDetails.name }} - {{ selectedSubmodule.path }}</span>
                </div>
                <AppButton
                  variant="secondary"
                  size="icon"
                  icon="close"
                  class="branch-menu-close"
                  aria-label="Close branch links"
                  title="Close"
                  @click="isSubmoduleLinkManagerOpen = false"
                >
                  Close
                </AppButton>
              </div>

              <div
                id="submodule-branch-link-table"
                class="submodule-link-table"
                role="table"
                aria-label="Repository branch links"
              >
                <div class="submodule-link-table-head" role="row">
                  <span role="columnheader">Repository branch</span>
                  <span role="columnheader">Submodule branch</span>
                </div>
                <div
                  v-for="row in submoduleLinkTableRows"
                  :key="`${selectedSubmodulePath}:${row.parentBranch}`"
                  class="submodule-link-table-row"
                  :class="{ current: row.current }"
                  role="row"
                >
                  <div class="submodule-link-parent-cell" role="cell">
                    <strong>{{ row.parentBranch }}</strong>
                    <small>{{ row.current ? "Current branch" : "Repository branch" }}</small>
                  </div>
                  <AppDropdown
                    :model-value="row.submoduleBranch"
                    menu-class="remote-branch-dropdown-menu submodule-link-dropdown-menu"
                    :options="submoduleLinkDropdownOptions"
                    @update:model-value="updateSubmoduleBranchLink(row.parentBranch, $event)"
                  />
                </div>
              </div>
            </section>
          </div>
        </Teleport>
      </div>
      <div class="detail-quick-actions" aria-label="Repository quick actions">
        <AppButton
          variant="secondary"
          size="icon"
          icon="folder"
          :aria-label="`Show ${selectedDetails.name} in files`"
          title="Show in files"
          @click="$emit('openInFileManager', selectedDetails.path)"
        >
          Show in files
        </AppButton>
        <AppButton
          variant="secondary"
          size="icon"
          icon="edit"
          :aria-label="`Open ${selectedDetails.name} in editor`"
          title="Open in editor"
          @click="$emit('openInEditor', selectedDetails.path)"
        >
          Open in editor
        </AppButton>
        <AppButton
          variant="secondary"
          size="icon"
          icon="terminal"
          :aria-label="`Open ${selectedDetails.name} terminal`"
          title="Open terminal"
          @click="$emit('openInTerminal', selectedDetails.path)"
        >
          Open terminal
        </AppButton>
        <AppButton
          variant="secondary"
          size="icon"
          icon="copy"
          :aria-label="`Copy path for ${selectedDetails.name}`"
          title="Copy path"
          @click="$emit('copyPath', selectedDetails.path)"
        >
          Copy path
        </AppButton>
      </div>
    </div>

    <div class="detail-refresh-area">
      <button
        ref="refreshButtonElement"
        type="button"
        class="secondary refresh-button"
        :class="{ pending: isDetailLoading, settling: isRefreshIconSettling }"
        :style="{
          '--refresh-start-angle': `${refreshIconStartAngle}deg`,
          '--refresh-end-angle': `${refreshIconEndAngle}deg`,
          '--refresh-settle-duration': `${refreshIconSettleDuration}ms`,
        }"
        :disabled="isDetailLoading"
        :title="isDetailLoading ? 'Refreshing repository' : autoRefreshLabel"
        :aria-busy="isDetailLoading"
        :aria-label="isDetailLoading ? 'Refreshing repository' : 'Refresh repository'"
        @click="$emit('refresh')"
      >
        <AppIcon name="restart" class="button-icon" />
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
</template>
