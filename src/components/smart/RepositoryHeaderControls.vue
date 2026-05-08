<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { RepositoryBranchLink } from "../../app-state";
import type { MergeBranchRequest, MergeLinkedSubmoduleBranchRequest, RepositoryDetails } from "../../repositories";
import { AppActionMenu, AppButton, AppDropdown, AppMenuItem } from "../ui";
import RepositoryBranchMenuTrigger from "./repository-header/RepositoryBranchMenuTrigger.vue";
import RepositoryHeaderStateSummary from "./repository-header/RepositoryHeaderStateSummary.vue";
import RepositoryQuickActions from "./repository-header/RepositoryQuickActions.vue";
import RepositoryRefreshButton from "./repository-header/RepositoryRefreshButton.vue";
import RepositorySubmoduleLinksModal from "./repository-header/RepositorySubmoduleLinksModal.vue";
import {
  type BranchFilterKey,
  branchCheckoutDisabledReason,
  branchMatchesFilter,
  branchMatchesSearch,
  branchSafetyNotes,
  branchFilters,
  branchSyncActionLabel,
  branchSyncDisabledReason,
  branchSyncLabel,
  branchSyncTitle,
  compareBranchNamesDescending,
  inferNextNumberedBranch,
  isCheckingOutBranch,
  isCheckingOutSubmoduleBranch as isSubmoduleCheckoutPending,
  isDeletingBranch,
  isDeletingSubmoduleBranch as isSubmoduleDeletePending,
  isSubmoduleBranchSyncActionReady,
  isSyncingBranch,
  isSyncingSubmoduleBranch as isSubmoduleSyncPending,
  submoduleBranchCheckoutDisabledReason as getSubmoduleBranchCheckoutDisabledReason,
  submoduleBranchSyncDisabledReason,
  submoduleBranchSyncTitle as getSubmoduleBranchSyncTitle,
} from "./repository-header/branchUtils";

const props = defineProps<{
  selectedDetails: RepositoryDetails | null;
  isDetailLoading: boolean;
  autoRefreshLabel: string;
  autoRefreshProgress: number;
  dashboardShortcutLabel: string;
  branchShortcutLabel: string;
  branchShortcutTriggerToken: number;
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
  dashboard: [];
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

const branchFilter = ref("all");
const branchSearchQuery = ref("");
const selectedRemoteBranchName = ref("");
const selectedSubmodulePath = ref("");
const targetParentBranchName = ref("");
const targetSubmoduleBranchName = ref("");
const isBranchMenuOpen = ref(false);
const isSubmoduleLinkManagerOpen = ref(false);
const syncConfettiBursts = ref<Array<{ id: number }>>([]);
let nextSyncConfettiBurstId = 0;
const syncConfettiTimers = new Set<number>();

const sortedBranches = computed(() => {
  const branches = props.selectedDetails?.gitBranches ?? [];

  return [...branches].sort((branchA, branchB) =>
    compareBranchNamesDescending(branchA.name, branchB.name)
  );
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
    .sort((branchA, branchB) => compareBranchNamesDescending(branchA.localName, branchB.localName)),
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
const selectedSubmoduleBranches = computed(() =>
  [...(selectedSubmodule.value?.branches ?? [])].sort((branchA, branchB) =>
    compareBranchNamesDescending(branchA.name, branchB.name)
  ),
);
const selectedSubmoduleBranchOptions = computed(() =>
  selectedSubmoduleBranches.value.map((branch) => ({
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
  ...selectedSubmoduleBranches.value.map((branch) => ({
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
  ...selectedSubmoduleBranches.value.map((branch) => ({
    label: branch.name,
    value: branch.name,
  })),
]);
const mergeConflictCount = computed(() => props.selectedDetails?.gitStatus.conflicted.length ?? 0);
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
  () => props.branchShortcutTriggerToken,
  (token) => {
    if (token === 0 || !props.selectedDetails) {
      return;
    }

    if (isBranchMenuOpen.value) {
      closeBranchMenu();
      return;
    }

    isBranchMenuOpen.value = true;
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

function branchMergeConflictMessage() {
  const conflictCount = mergeConflictCount.value;

  return `Merge stopped with ${conflictCount} ${conflictCount === 1 ? "conflict" : "conflicts"}. Resolve conflicts, stage, and commit.`;
}

function clearBranchSearch() {
  branchSearchQuery.value = "";
}

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

function isSyncingSubmoduleBranch(submodulePath: string, branchName: string) {
  return isSubmoduleSyncPending(props.syncingSubmoduleBranchName, submodulePath, branchName);
}

function isCheckingOutSubmoduleBranch(submodulePath: string, branchName: string) {
  return isSubmoduleCheckoutPending(props.checkingOutSubmoduleBranchName, submodulePath, branchName);
}

function isDeletingSubmoduleBranch(submodulePath: string, branchName: string) {
  return isSubmoduleDeletePending(props.deletingSubmoduleBranchName, submodulePath, branchName);
}

function submoduleBranchCheckoutDisabledReason(submodule: RepositoryDetails["gitSubmodules"][number]) {
  return getSubmoduleBranchCheckoutDisabledReason(submodule, props);
}

function submoduleBranchSyncTitle(
  submodule: RepositoryDetails["gitSubmodules"][number],
  branch: RepositoryDetails["gitSubmodules"][number]["branches"][number],
) {
  return getSubmoduleBranchSyncTitle(submodule, branch, props.syncingSubmoduleBranchName);
}

function checkoutSelectedRemoteBranch() {
  if (!selectedRemoteBranchName.value) {
    return;
  }

  emit("checkoutRemoteBranch", selectedRemoteBranchName.value);
}

onBeforeUnmount(() => {
  syncConfettiTimers.forEach((timer) => window.clearTimeout(timer));
  syncConfettiTimers.clear();
});
</script>

<template>
  <div class="detail-command-bar">
    <nav class="detail-nav" aria-label="Repository detail navigation">
      <AppButton
        variant="secondary"
        icon="home"
        class="detail-dashboard-button"
        :title="`Dashboard (${dashboardShortcutLabel})`"
        @click="$emit('dashboard')"
      >
        Dashboard
        <template #trailing>
          <kbd class="shortcut-label detail-dashboard-shortcut">{{ dashboardShortcutLabel }}</kbd>
        </template>
      </AppButton>

      <RepositoryHeaderStateSummary
        v-if="selectedDetails"
        :selected-details="selectedDetails"
      />
    </nav>

    <div v-if="selectedDetails" class="detail-repository-tools" aria-label="Repository actions">
      <div class="branch-menu">
        <RepositoryBranchMenuTrigger
          :branch-menu-label="branchMenuLabel"
          :branch-shortcut-label="branchShortcutLabel"
          :commit-celebrations="commitCelebrations"
          :current-branch="currentBranch"
          :current-branch-sync-label="currentBranchSyncLabel"
          :deleting-branch-name="deletingBranchName"
          :is-branch-menu-open="isBranchMenuOpen"
          :selected-details="selectedDetails"
          :sync-confetti-bursts="syncConfettiBursts"
          :sync-shortcut-label="syncShortcutLabel"
          :syncing-branch-name="syncingBranchName"
          @sync-branch="$emit('syncBranch', $event)"
          @toggle-menu="isBranchMenuOpen = !isBranchMenuOpen"
        />

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
                <span
                  class="panel-subtitle branch-menu-current-branch"
                  :title="`${selectedDetails.name} - current branch ${selectedDetails.branch}`"
                >
                  <span class="branch-menu-repository-name">{{ selectedDetails.name }}</span>
                  <strong
                    class="branch-menu-current-name"
                    :class="{ celebration: commitCelebrations }"
                  >
                    Currently on "{{ selectedDetails.branch }}"
                  </strong>
                </span>
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

                  <AppButton
                    v-else
                    variant="primary"
                    icon="merge"
                    class="branch-primary-action branch-merge-direct-action"
                    :disabled="Boolean(parentBranchMergeDisabledReason)"
                    :title="parentBranchMergeDisabledReason || parentMergeRouteLabel || 'Merge parent repository'"
                    @click="mergeBranch"
                  >
                    {{
                      mergingBranchName
                        ? `Merging into ${mergingBranchName}...`
                        : 'Merge branch'
                    }}
                  </AppButton>
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
                      <span>{{ selectedSubmoduleBranches.length }} shown</span>
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
                    v-if="selectedSubmoduleBranches.length > 0"
                    id="submodule-local-branches"
                    class="submodule-branch-list"
                  >
                    <li
                      v-for="branch in selectedSubmoduleBranches"
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
                            <small
                              v-if="branch.current && mergeConflictCount > 0"
                              class="branch-conflict-marker"
                            >
                              Merge conflicts
                            </small>
                          </span>
                          <small>
                            {{ branch.upstream ?? "No upstream" }}
                          </small>
                        </div>
                        <p
                          v-if="branch.current && mergeConflictCount > 0"
                          class="branch-conflict-feedback"
                        >
                          {{ branchMergeConflictMessage() }}
                        </p>
                        <p v-else-if="branchFeedbackMessages[branch.name]" class="branch-feedback">
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
          <RepositorySubmoduleLinksModal
            v-if="isSubmoduleLinkManagerOpen && selectedSubmodule"
            :dropdown-options="submoduleLinkDropdownOptions"
            :repository-name="selectedDetails.name"
            :rows="submoduleLinkTableRows"
            :selected-submodule="selectedSubmodule"
            :selected-submodule-path="selectedSubmodulePath"
            @close="isSubmoduleLinkManagerOpen = false"
            @update-link="updateSubmoduleBranchLink"
          />
        </Teleport>
      </div>
      <RepositoryQuickActions
        :repository-name="selectedDetails.name"
        :repository-path="selectedDetails.path"
        @copy-path="$emit('copyPath', $event)"
        @open-in-editor="$emit('openInEditor', $event)"
        @open-in-file-manager="$emit('openInFileManager', $event)"
        @open-in-terminal="$emit('openInTerminal', $event)"
      />
    </div>

    <div class="detail-refresh-area">
      <RepositoryRefreshButton
        :auto-refresh-label="autoRefreshLabel"
        :auto-refresh-progress="autoRefreshProgress"
        :is-detail-loading="isDetailLoading"
        @refresh="$emit('refresh')"
      />
    </div>
  </div>
</template>
