<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { RepositoryBranchLink } from "../../app-state";
import type { MergeBranchRequest, MergeLinkedSubmoduleBranchRequest, RepositoryDetails } from "../../repositories";
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
  syncingSubmoduleBranchName: string | null;
  deletingBranchName: string | null;
  deletingSubmoduleBranchName: string | null;
  checkingOutBranchName: string | null;
  checkingOutSubmoduleBranchName: string | null;
  mergingBranchName: string | null;
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
  checkoutSubmoduleBranch: [submodulePath: string, branchName: string];
  syncBranch: [branchName: string];
  syncSubmoduleBranch: [submodulePath: string, branchName: string];
  mergeBranch: [request: Omit<MergeBranchRequest, "repoPath">];
  saveRepositoryBranchLink: [link: Omit<RepositoryBranchLink, "updatedAt">];
  removeRepositoryBranchLink: [link: Pick<RepositoryBranchLink, "repoPath" | "parentBranch" | "submodulePath">];
  mergeLinkedSubmoduleBranch: [request: Omit<MergeLinkedSubmoduleBranchRequest, "repoPath">];
  copyPath: [repoPath: string];
  openInEditor: [repoPath: string];
  openInFileManager: [repoPath: string];
  openInTerminal: [repoPath: string];
}>();

type SyncableBranch =
  | RepositoryDetails["gitBranches"][number]
  | RepositoryDetails["gitSubmodules"][number]["branches"][number];

const branchFilter = ref("all");
const branchSearchQuery = ref("");
const selectedRemoteBranchName = ref("");
const selectedSubmodulePath = ref("");
const targetParentBranchName = ref("");
const targetSubmoduleBranchName = ref("");
const isBranchMenuOpen = ref(false);
const isSubmoduleLinkManagerOpen = ref(false);
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
const selectedSubmoduleBranchOptions = computed(() =>
  (selectedSubmodule.value?.branches ?? []).map((branch) => ({
    label: branch.current ? `${branch.name} (current)` : branch.name,
    value: branch.name,
  })),
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
const linkedSubmoduleMergeRows = computed(() => {
  if (!props.selectedDetails || !currentBranch.value || !targetParentBranchName.value) {
    return [];
  }

  return props.selectedDetails.gitSubmodules
    .map((submodule) => {
      const sourceBranch = findSavedSubmoduleLinkByPath(
        submodule.path,
        props.selectedDetails?.branch ?? "",
      )?.submoduleBranch ?? "";
      const targetBranch = findSavedSubmoduleLinkByPath(
        submodule.path,
        targetParentBranchName.value,
      )?.submoduleBranch ?? "";
      const sourceBranchExists = !sourceBranch ||
        submodule.branches.some((branch) => branch.name === sourceBranch);
      const targetBranchExists = !targetBranch ||
        submodule.branches.some((branch) => branch.name === targetBranch);

      return {
        dirty: submodule.dirty,
        sourceBranch,
        sourceBranchExists,
        submodulePath: submodule.path,
        targetBranch,
        targetBranchExists,
      };
    })
    .filter((row) => row.sourceBranch || row.targetBranch);
});
const linkedSubmoduleMergeRoutes = computed(() =>
  linkedSubmoduleMergeRows.value
    .filter((row) =>
      row.sourceBranch &&
      row.targetBranch &&
      row.sourceBranchExists &&
      row.targetBranchExists &&
      !row.dirty
    )
    .map((row) => ({
      sourceSubmoduleBranch: row.sourceBranch,
      submodulePath: row.submodulePath,
      targetSubmoduleBranch: row.targetBranch,
    })),
);
const linkedSubmoduleMergeCount = computed(() => linkedSubmoduleMergeRoutes.value.length);
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
const targetParentBranchOptions = computed(() =>
  sortedBranches.value
    .filter((branch) => !branch.current)
    .map((branch) => ({
      label: branch.name,
      value: branch.name,
    })),
);
const targetSubmoduleBranchOptions = computed(() => [
  { label: "No target", value: "" },
  ...(selectedSubmodule.value?.branches ?? []).map((branch) => ({
    label: branch.name,
    value: branch.name,
  })),
]);
const parentMergeRouteLabel = computed(() => {
  if (!props.selectedDetails) {
    return "";
  }

  return `${props.selectedDetails.branch} -> ${targetParentBranchName.value || "target"}`;
});
const parentBranchMergeDisabledReason = computed(() => {
  if (!props.selectedDetails) {
    return "No repository selected.";
  }

  if (!currentBranch.value) {
    return "No current branch was found.";
  }

  if (props.selectedDetails.gitStatus.conflicted.length > 0 || !props.selectedDetails.gitStatus.clean) {
    return "Commit, stash, or discard repository changes before merging.";
  }

  if (!targetParentBranchName.value) {
    return "Choose a target branch.";
  }

  if (targetParentBranchName.value === props.selectedDetails.branch) {
    return "Choose a different target branch.";
  }

  if (props.syncingBranchName || props.deletingBranchName || props.checkingOutBranchName) {
    return "Wait for the current branch action to finish.";
  }

  if (props.mergingBranchName || props.mergingLinkedBranchName) {
    return "A branch merge is already running.";
  }

  return "";
});
const linkedSubmoduleRouteLabel = computed(() => {
  if (!props.selectedDetails) {
    return "";
  }

  return [
    `${props.selectedDetails.branch} -> ${targetParentBranchName.value || "target"}`,
    `${linkedSubmoduleMergeCount.value} linked ${linkedSubmoduleMergeCount.value === 1 ? "submodule" : "submodules"}`,
  ].join(" | ");
});
const linkedBranchMergeDisabledReason = computed(() => {
  if (!props.selectedDetails) {
    return "No repository selected.";
  }

  if (!currentBranch.value) {
    return "No current parent branch was found.";
  }

  if (props.selectedDetails.gitStatus.conflicted.length > 0 || !props.selectedDetails.gitStatus.clean) {
    return "Commit, stash, or discard parent repository changes before merging.";
  }

  if (!targetParentBranchName.value) {
    return "Choose a parent target branch.";
  }

  if (targetParentBranchName.value === props.selectedDetails.branch) {
    return "Choose a different parent target branch.";
  }

  if (linkedSubmoduleMergeRows.value.length === 0) {
    return "Save linked submodule branches for the source and target parent branches.";
  }

  if (linkedSubmoduleMergeRows.value.some((row) => !row.sourceBranch || !row.targetBranch)) {
    return "Complete every linked submodule route for the source and target parent branches.";
  }

  if (linkedSubmoduleMergeRows.value.some((row) => !row.sourceBranchExists || !row.targetBranchExists)) {
    return "Fix saved links that point to missing submodule branches.";
  }

  if (linkedSubmoduleMergeRows.value.some((row) => row.dirty)) {
    return "Commit, stash, or discard linked submodule changes before merging.";
  }

  if (props.syncingBranchName || props.deletingBranchName || props.checkingOutBranchName) {
    return "Wait for the current branch action to finish.";
  }

  if (props.mergingBranchName || props.mergingLinkedBranchName) {
    return "A branch merge is already running.";
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
    isBranchMenuOpen.value = false;
  },
);

watch(
  selectedSubmodulePath,
  () => {
    isSubmoduleLinkManagerOpen.value = false;
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
  [currentBranch, targetParentBranchOptions],
  () => {
    const targetOptions = targetParentBranchOptions.value;

    if (!targetOptions.some((option) => option.value === targetParentBranchName.value)) {
      targetParentBranchName.value =
        inferNextNumberedBranch(
          props.selectedDetails?.branch ?? "",
          props.selectedDetails?.gitBranches.map((branch) => branch.name) ?? [],
        ) ||
        targetOptions[0]?.value ||
        "";
    }
  },
  { immediate: true },
);

watch(
  [selectedSubmodule, targetParentBranchName, targetSubmoduleBranchOptions, savedLinksForSelectedRepository],
  () => {
    if (!props.selectedDetails || !selectedSubmodule.value || !targetParentBranchName.value) {
      targetSubmoduleBranchName.value = "";
      return;
    }

    const linkedSubmoduleBranch = findSavedSubmoduleLink(targetParentBranchName.value)?.submoduleBranch ?? "";

    targetSubmoduleBranchName.value = targetSubmoduleBranchOptions.value.some((option) =>
      option.value === linkedSubmoduleBranch
    )
      ? linkedSubmoduleBranch
      : "";
  },
  { immediate: true },
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

  return findSavedSubmoduleLinkByPath(selectedSubmodulePath.value, parentBranch);
}

function findSavedSubmoduleLinkByPath(submodulePath: string, parentBranch: string) {
  return savedLinksForSelectedRepository.value.find((link) =>
    link.parentBranch === parentBranch &&
    link.submodulePath === submodulePath
  );
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
}

function updateTargetSubmoduleBranchLink(submoduleBranchValue: string | number) {
  targetSubmoduleBranchName.value = String(submoduleBranchValue);

  if (!targetParentBranchName.value) {
    return;
  }

  updateSubmoduleBranchLink(targetParentBranchName.value, submoduleBranchValue);
}

function checkoutSelectedSubmoduleBranch(branchValue: string | number) {
  if (!selectedSubmodule.value) {
    return;
  }

  const branchName = String(branchValue);

  if (!branchName || branchName === selectedSubmodule.value.branch) {
    return;
  }

  emit("checkoutSubmoduleBranch", selectedSubmodule.value.path, branchName);
}

function closeBranchMenu() {
  isSubmoduleLinkManagerOpen.value = false;
  isBranchMenuOpen.value = false;
}

function mergeBranch() {
  if (!props.selectedDetails || !currentBranch.value || parentBranchMergeDisabledReason.value) {
    return;
  }

  emit("mergeBranch", {
    sourceBranch: props.selectedDetails.branch,
    targetBranch: targetParentBranchName.value,
  });
}

function mergeLinkedBranches() {
  if (!props.selectedDetails || linkedBranchMergeDisabledReason.value) {
    return;
  }

  emit("mergeLinkedSubmoduleBranch", {
    sourceParentBranch: props.selectedDetails.branch,
    targetParentBranch: targetParentBranchName.value,
    routes: linkedSubmoduleMergeRoutes.value,
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

function branchSyncLabel(branch: SyncableBranch) {
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
  branch: SyncableBranch,
  gitStatus: RepositoryDetails["gitStatus"],
) {
  if (hasStagedOrUnstagedChanges(gitStatus)) {
    return "Commit, stash, or discard staged and unstaged changes before syncing.";
  }

  return branchSyncMetadataDisabledReason(branch);
}

function branchSyncMetadataDisabledReason(branch: SyncableBranch) {
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

function isSyncingSubmoduleBranch(submodulePath: string, branchName: string) {
  return props.syncingSubmoduleBranchName === `${submodulePath}:${branchName}`;
}

function isBranchSyncActionReady(
  branch: SyncableBranch,
  gitStatus: RepositoryDetails["gitStatus"],
) {
  return !branch.inSyncWithRemote && !branchSyncDisabledReason(branch, gitStatus);
}

function isSubmoduleBranchSyncActionReady(
  submodule: RepositoryDetails["gitSubmodules"][number],
  branch: RepositoryDetails["gitSubmodules"][number]["branches"][number],
) {
  return !branch.inSyncWithRemote && !submoduleBranchSyncDisabledReason(submodule, branch);
}

function isDeletingBranch(branchName: string, deletingBranchName: string | null) {
  return deletingBranchName === branchName;
}

function isCheckingOutBranch(branchName: string, checkingOutBranchName: string | null) {
  return checkingOutBranchName === branchName;
}

function isCheckingOutSubmoduleBranch(submodulePath: string, branchName: string) {
  return props.checkingOutSubmoduleBranchName === `${submodulePath}:${branchName}`;
}

function branchCheckoutDisabledReason(gitStatus: RepositoryDetails["gitStatus"]) {
  return gitStatus.clean
    ? undefined
    : "Commit, stash, or discard working tree changes before switching branches.";
}

function submoduleBranchCheckoutDisabledReason(submodule: RepositoryDetails["gitSubmodules"][number]) {
  if (submodule.dirty) {
    return "Commit, stash, or discard submodule changes before switching branches.";
  }

  if (
    props.checkingOutBranchName ||
    props.checkingOutSubmoduleBranchName ||
    props.syncingBranchName ||
    props.syncingSubmoduleBranchName ||
    props.deletingSubmoduleBranchName ||
    props.mergingBranchName ||
    props.mergingLinkedBranchName
  ) {
    return "Wait for the current branch action to finish.";
  }

  return "";
}

function branchSyncTitle(
  branch: SyncableBranch,
  gitStatus: RepositoryDetails["gitStatus"],
  syncingBranchName: string | null,
) {
  if (isSyncingBranch(branch.name, syncingBranchName)) {
    return `Syncing ${branch.name}`;
  }

  return branchSyncDisabledReason(branch, gitStatus) ?? branchSyncActionTitle(branch);
}

function submoduleBranchSyncTitle(
  submodule: RepositoryDetails["gitSubmodules"][number],
  branch: RepositoryDetails["gitSubmodules"][number]["branches"][number],
) {
  if (isSyncingSubmoduleBranch(submodule.path, branch.name)) {
    return `Syncing ${branch.name}`;
  }

  if (branch.inSyncWithRemote) {
    return "Branch is in sync with its remote.";
  }

  return submoduleBranchSyncDisabledReason(submodule, branch) ?? branchSyncActionTitle(branch);
}

function submoduleBranchSyncDisabledReason(
  submodule: RepositoryDetails["gitSubmodules"][number],
  branch: RepositoryDetails["gitSubmodules"][number]["branches"][number],
) {
  if (submodule.dirty) {
    return "Commit, stash, or discard submodule changes before syncing.";
  }

  return branchSyncMetadataDisabledReason(branch);
}

function branchSyncActionLabel(branch: SyncableBranch) {
  if (branch.ahead > 0 && branch.behind === 0) {
    return "Push";
  }

  if (branch.behind > 0 && branch.ahead === 0) {
    return "Pull";
  }

  return "Sync";
}

function branchSyncActionIcon(
  branch: SyncableBranch,
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

function branchSyncActionTitle(branch: SyncableBranch) {
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

            <div
              class="branch-menu-layout"
              :class="{ 'has-submodule-card': selectedDetails.gitSubmodules.length > 0 }"
            >
              <section
                v-if="currentBranch"
                class="branch-merge-top-card branch-merge-combined-card"
                aria-label="Merge actions"
              >
                <div class="branch-menu-section-heading compact">
                  <div>
                    <h4>Merge branch</h4>
                  </div>
                </div>

                <div
                  class="branch-merge-combined-controls"
                  :class="{ 'has-submodule-controls': selectedDetails.gitSubmodules.length > 0 }"
                >
                  <div class="branch-merge-route-card">
                    <div class="linked-submodule-field">
                      <label for="merge-target-parent-branch-select">Target</label>
                      <AppDropdown
                        id="merge-target-parent-branch-select"
                        v-model="targetParentBranchName"
                        menu-class="remote-branch-dropdown-menu"
                        :disabled="targetParentBranchOptions.length === 0"
                        :options="targetParentBranchOptions"
                      />
                    </div>
                  </div>

                  <div
                    v-if="selectedDetails.gitSubmodules.length > 0"
                    class="branch-merge-route-card"
                  >
                    <div class="branch-merge-submodule-fields">
                      <div class="linked-submodule-field">
                        <label for="linked-submodule-select">Submodule</label>
                        <AppDropdown
                          id="linked-submodule-select"
                          v-model="selectedSubmodulePath"
                          menu-class="remote-branch-dropdown-menu"
                          :options="submoduleOptions"
                        />
                      </div>

                      <div class="linked-submodule-field">
                        <label for="target-submodule-branch-select">Target</label>
                        <AppDropdown
                          id="target-submodule-branch-select"
                          :model-value="targetSubmoduleBranchName"
                          menu-class="remote-branch-dropdown-menu"
                          :disabled="!selectedSubmodule || !targetParentBranchName"
                          :options="targetSubmoduleBranchOptions"
                          @update:model-value="updateTargetSubmoduleBranchLink"
                        />
                      </div>
                    </div>
                  </div>

                  <div
                    v-if="selectedDetails.gitSubmodules.length > 0"
                    class="branch-merge-action-card"
                  >
                    <div class="linked-submodule-summary">
                      <span class="current-branch-action-kicker">Scope</span>
                      <strong>{{ linkedSubmoduleMergeCount }} linked {{ linkedSubmoduleMergeCount === 1 ? "route" : "routes" }}</strong>
                    </div>
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
                      Links
                    </AppButton>
                    <AppActionMenu
                      align="right"
                      class="branch-merge-action-menu"
                      label="Merge branch"
                      trigger-class="branch-primary-action branch-merge-menu-trigger"
                      trigger-icon="merge"
                      trigger-variant="primary"
                      :trigger-text="
                        mergingBranchName || mergingLinkedBranchName
                          ? `Merging into ${mergingBranchName || mergingLinkedBranchName}...`
                          : 'Merge'
                      "
                    >
                      <AppMenuItem
                        icon="merge"
                        :disabled="Boolean(parentBranchMergeDisabledReason)"
                        :title="parentBranchMergeDisabledReason || parentMergeRouteLabel || 'Merge parent repository only'"
                        @click="mergeBranch"
                      >
                        Without submodules
                      </AppMenuItem>
                      <AppMenuItem
                        icon="link"
                        :disabled="Boolean(linkedBranchMergeDisabledReason)"
                        :title="linkedBranchMergeDisabledReason || linkedSubmoduleRouteLabel || 'Merge parent repository and linked submodule branches'"
                        @click="mergeLinkedBranches"
                      >
                        With submodules
                      </AppMenuItem>
                    </AppActionMenu>
                  </div>

                  <AppActionMenu
                    v-else
                    align="right"
                    class="branch-merge-action-menu"
                    label="Merge branch"
                    trigger-class="branch-primary-action branch-merge-menu-trigger"
                    trigger-icon="merge"
                    trigger-variant="primary"
                    :trigger-text="
                      mergingBranchName
                        ? `Merging into ${mergingBranchName}...`
                        : 'Merge'
                    "
                  >
                    <AppMenuItem
                      icon="merge"
                      :disabled="Boolean(parentBranchMergeDisabledReason)"
                      :title="parentBranchMergeDisabledReason || parentMergeRouteLabel || 'Merge parent repository'"
                      @click="mergeBranch"
                    >
                      Merge branch
                    </AppMenuItem>
                  </AppActionMenu>
                </div>

                <div class="branch-merge-helper-row">
                  <p
                    v-if="
                      parentBranchMergeDisabledReason ||
                      (selectedDetails.gitSubmodules.length > 0 && linkedBranchMergeDisabledReason)
                    "
                    class="branch-safety"
                  >
                    {{
                      selectedDetails.gitSubmodules.length > 0
                        ? linkedBranchMergeDisabledReason || parentBranchMergeDisabledReason
                        : parentBranchMergeDisabledReason
                    }}
                  </p>
                </div>
              </section>

              <div
                v-if="selectedDetails.gitSubmodules.length > 0"
                class="branch-submodule-card"
                aria-label="Submodule branches"
              >
                <div
                  v-if="selectedSubmodule"
                  class="branch-menu-section-heading branch-submodule-card-heading"
                >
                  <div>
                    <h4>Submodule local branches</h4>
                    <span>{{ selectedSubmodule.path }} - {{ selectedSubmodule.branch }}</span>
                  </div>
                </div>

                <section
                  v-if="selectedSubmodule"
                  class="submodule-local-branch-panel"
                  aria-label="Selected submodule local branches"
                >
                  <div class="submodule-branch-heading">
                    <div>
                      <h4>Local branches</h4>
                      <span>{{ selectedSubmodule.branches.length }} shown</span>
                    </div>
                    <label
                      class="submodule-current-branch-switcher"
                      :title="submoduleBranchCheckoutDisabledReason(selectedSubmodule) || 'Switch current submodule branch'"
                    >
                      <span>Current</span>
                      <AppDropdown
                        :model-value="selectedSubmodule.branch"
                        :options="selectedSubmoduleBranchOptions"
                        :disabled="
                          selectedSubmoduleBranchOptions.length === 0 ||
                          Boolean(submoduleBranchCheckoutDisabledReason(selectedSubmodule))
                        "
                        @update:model-value="checkoutSelectedSubmoduleBranch"
                      />
                    </label>
                  </div>

                  <ul
                    v-if="selectedSubmodule.branches.length > 0"
                    id="submodule-local-branches"
                    class="submodule-branch-list"
                  >
                    <li
                      v-for="branch in selectedSubmodule.branches"
                      :key="`${selectedSubmodule.path}:${branch.name}`"
                      :class="{
                        current: branch.current,
                        pending: isCheckingOutSubmoduleBranch(selectedSubmodule.path, branch.name),
                      }"
                    >
                      <div>
                        <strong>{{ branch.name }}</strong>
                        <small>{{ branch.upstream ?? (branch.current ? "Current branch" : "Local branch") }}</small>
                      </div>
                      <div class="branch-controls submodule-branch-controls">
                        <span class="branch-action-tooltip" :title="submoduleBranchSyncTitle(selectedSubmodule, branch)">
                          <AppButton
                            variant="secondary"
                            size="icon"
                            :icon="branch.inSyncWithRemote ? 'check' : 'restart'"
                            class="branch-action branch-row-sync-button branch-menu-sync-button"
                            :class="{
                              active:
                                commitCelebrations &&
                                isSubmoduleBranchSyncActionReady(selectedSubmodule, branch),
                              pending: isSyncingSubmoduleBranch(selectedSubmodule.path, branch.name),
                              synced: branch.inSyncWithRemote,
                            }"
                            :disabled="
                              branch.inSyncWithRemote ||
                              Boolean(submoduleBranchSyncDisabledReason(selectedSubmodule, branch)) ||
                              Boolean(syncingBranchName) ||
                              Boolean(syncingSubmoduleBranchName) ||
                              Boolean(checkingOutSubmoduleBranchName) ||
                              Boolean(deletingSubmoduleBranchName) ||
                              Boolean(mergingLinkedBranchName)
                            "
                            :title="submoduleBranchSyncTitle(selectedSubmodule, branch)"
                            :aria-busy="isSyncingSubmoduleBranch(selectedSubmodule.path, branch.name)"
                            :aria-label="
                              branch.inSyncWithRemote
                                ? `Submodule branch ${branch.name} is in sync`
                                : `${branchSyncActionLabel(branch)} submodule branch ${branch.name}`
                            "
                            @click="$emit('syncSubmoduleBranch', selectedSubmodule.path, branch.name)"
                          >
                            {{
                              isSyncingSubmoduleBranch(selectedSubmodule.path, branch.name)
                                ? `${branchSyncActionLabel(branch)}ing...`
                                : branchSyncActionLabel(branch)
                            }}
                          </AppButton>
                        </span>
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
                              Boolean(checkingOutSubmoduleBranchName) ||
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
                      </div>
                    </li>
                  </ul>
                  <p
                    v-else
                    id="submodule-local-branches"
                    class="branch-empty-state"
                  >
                    No local branches found for this submodule.
                  </p>
                </section>
              </div>

              <div class="branch-parent-card">
                <div class="branch-menu-section-heading branch-parent-card-heading">
                  <div>
                    <h4>Parent repository</h4>
                    <span>{{ currentBranchSyncLabel }}</span>
                  </div>
                </div>

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

                  <div class="branch-list-scroll">
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
                        <div class="branch-row-main">
                          <span class="branch-row-title">
                            <strong>{{ branch.name }}</strong>
                            <small v-if="branch.current" class="branch-current-marker">Current</small>
                          </span>
                          <small>
                            {{ branch.upstream ?? "No upstream" }}
                          </small>
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
                            v-if="!branch.inSyncWithRemote"
                            variant="secondary"
                            class="branch-action"
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
                          </AppButton>
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
                            v-if="!branch.current"
                            :label="`More actions for ${branch.name}`"
                          >
                            <AppMenuItem
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

                    <form
                      v-if="remoteBranchesToCreate.length > 0"
                      class="remote-branch-checkout branch-list-footer"
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
                  </div>
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
