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

<style scoped>
.detail-nav {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.detail-command-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: calc(100% + (var(--shell-x) * 2));
  min-height: 52px;
  margin: 0;
  margin-left: calc(var(--shell-x) * -1);
  border: 0;
  border-top: 1px solid var(--border-soft);
  border-radius: 0;
  padding: 7px var(--shell-x);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--surface-subtle) 72%, var(--app-bg)),
    color-mix(in srgb, var(--surface-subtle) 54%, var(--app-bg))
  );
  -webkit-app-region: no-drag;
}

.detail-command-bar {
  border-top: 1px solid var(--border-soft);
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface-subtle) 82%, var(--app-bg)),
      color-mix(in srgb, var(--surface-subtle) 62%, var(--app-bg))
    );
  box-shadow: none;
}

.detail-dashboard-button {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 6px;
  border-color: transparent;
  padding: 0 10px;
  background: transparent;
  color: var(--muted-strong);
}

.detail-dashboard-button:hover:not(:disabled) {
  border-color: transparent;
  background: var(--surface-subtle);
  color: var(--text);
}

.detail-dashboard-button :deep(.button-icon) {
  width: 16px;
  height: 16px;
}

.detail-dashboard-shortcut {
  margin-left: 2px;
}
.detail-repository-tools {
  display: flex;
  flex: 0 1 auto;
  min-width: 0;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}

.branch-menu {
  position: relative;
  min-width: 0;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(4, 8, 12, 0.62);
}

.branch-menu-modal-backdrop {
  z-index: 52;
  align-items: start;
  overflow: hidden;
}

.submodule-link-modal-backdrop {
  z-index: 62;
  background: rgba(4, 8, 12, 0.42);
}

.branch-menu-panel {
  display: grid;
  width: min(1120px, 100%);
  height: min(760px, calc(100vh - 48px));
  max-height: calc(100vh - 48px);
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
  border: 1px solid var(--border-control);
  border-radius: 8px;
  padding: 12px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.submodule-link-modal {
  display: grid;
  width: min(640px, 100%);
  max-height: min(620px, calc(100vh - 80px));
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  overflow: hidden;
  border: 1px solid var(--border-control);
  border-radius: 8px;
  padding: 12px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.submodule-link-modal-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.submodule-link-modal .submodule-link-table {
  max-height: none;
  min-height: 0;
}

.submodule-link-dropdown-menu {
  z-index: 70;
}

.branch-menu-layout {
  display: grid;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
}

.branch-menu-layout.has-submodule-card {
  grid-template-columns: minmax(0, 1fr) minmax(300px, 390px);
}

.branch-merge-top-card {
  display: grid;
  min-width: 0;
  grid-column: 1 / -1;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 10px;
  border: 1px solid color-mix(in srgb, var(--border-control) 72%, transparent);
  border-radius: 7px;
  padding: 10px;
  background: var(--surface-soft);
}

.branch-merge-combined-card {
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}

.branch-merge-combined-controls {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) auto;
  gap: 8px 10px;
  align-items: center;
}

.branch-merge-combined-controls.has-submodule-controls {
  grid-template-columns: minmax(280px, 0.9fr) minmax(420px, 1.35fr);
}

.branch-merge-route-card,
.branch-merge-action-card {
  display: grid;
  min-width: 0;
  align-self: stretch;
  gap: 7px;
  border: 1px solid color-mix(in srgb, var(--border-control) 66%, transparent);
  border-radius: 7px;
  padding: 8px;
  background: color-mix(in srgb, var(--surface) 56%, transparent);
}

.branch-merge-submodule-fields {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.85fr);
  gap: 6px;
}

.branch-merge-action-card {
  grid-column: 1 / -1;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  background: color-mix(in srgb, var(--surface-hover) 52%, transparent);
}

.branch-merge-action-menu {
  justify-self: end;
}

.branch-merge-direct-action {
  justify-self: end;
}

.branch-merge-action-menu :deep(.action-menu-trigger) {
  width: auto;
  min-height: 28px;
  padding: 0 10px;
  justify-content: center;
}

.branch-merge-menu-trigger::after {
  content: "";
  width: 0;
  height: 0;
  border-top: 5px solid currentColor;
  border-right: 4px solid transparent;
  border-left: 4px solid transparent;
  opacity: 0.82;
}

.branch-merge-action-card .branch-action {
  justify-content: center;
}

.branch-merge-helper-row {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
}

.branch-merge-helper-row .branch-safety {
  margin: 0;
}

.branch-parent-card,
.branch-submodule-card,
.branch-menu-side,
.branch-menu-main {
  display: grid;
  min-height: 0;
  gap: 8px;
}

.branch-parent-card,
.branch-submodule-card {
  align-content: start;
  border-radius: 7px;
  padding: 10px;
  background: var(--surface-soft);
}

.branch-parent-card {
  order: 1;
  grid-column: 1 / -1;
  grid-row: 2;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  overflow: hidden;
}

.branch-parent-card-heading {
  border-bottom: 1px solid color-mix(in srgb, var(--border-soft) 82%, transparent);
  padding: 0 2px 8px;
}

.branch-menu-layout.has-submodule-card .branch-parent-card {
  grid-column: 1;
}

.branch-submodule-card {
  order: 2;
  grid-column: 2;
  grid-row: 2;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  overflow: hidden;
}

.branch-submodule-card-heading {
  border-bottom: 1px solid color-mix(in srgb, var(--border-soft) 82%, transparent);
  padding: 0 2px 8px;
}

.branch-menu-panel .branch-parent-card > .git-branches {
  border: 1px solid color-mix(in srgb, var(--border-control) 68%, transparent);
  border-radius: 7px;
  padding: 8px;
  background: color-mix(in srgb, var(--surface) 50%, transparent);
}

.branch-menu-side {
  align-content: start;
  grid-auto-rows: auto;
  overflow: auto;
}

.branch-menu-main {
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

.branch-menu-main.has-submodule-local-branches {
  grid-template-rows: auto minmax(0, 1fr);
}

.branch-list-toolbar {
  position: sticky;
  z-index: 2;
  top: 0;
  display: grid;
  grid-template-columns: minmax(260px, 0.95fr) minmax(320px, 1.05fr);
  gap: 6px 10px;
  align-items: center;
  border-bottom: 1px solid var(--border-soft);
  padding-bottom: 6px;
  background: var(--surface-soft);
}

.branch-menu-close {
  width: 30px;
  min-height: 30px;
  padding: 0;
}

.branch-menu-panel .panel-heading {
  gap: 10px;
}

.panel-heading.branch-menu-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
}

.branch-menu-heading-stats {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.branch-menu-heading-stats span {
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  border-radius: 999px;
  padding: 0 9px;
  background: var(--surface-soft);
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  white-space: nowrap;
}

.branch-menu-panel .panel-subtitle {
  overflow: hidden;
  max-width: min(520px, 100%);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-menu-current-branch {
  display: flex;
  align-items: center;
  gap: 12px;
}

.branch-menu-repository-name {
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  text-overflow: ellipsis;
}

.branch-menu-current-name {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  border-radius: 999px;
  line-height: 1.2;
}

.branch-menu-current-name {
  position: relative;
  max-width: min(260px, 42vw);
  margin-left: 4px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--brand) 28%, var(--border-control));
  padding: 4px 11px;
  background: color-mix(in srgb, var(--brand-ring) 36%, var(--surface));
  color: var(--brand-text-hover);
  font-size: var(--font-size-base);
  font-weight: 950;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-menu-current-name.celebration {
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
  text-shadow: 0 1px 1px rgba(14, 20, 25, 0.32);
  box-shadow:
    0 8px 18px rgba(255, 79, 139, 0.2),
    0 4px 12px rgba(67, 217, 255, 0.14),
    0 0 0 1px rgba(255, 255, 255, 0.24);
  animation: rainbow-button-flow 8s linear infinite;
}

.branch-menu-current-name.celebration::before {
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

.branch-menu-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.branch-menu-section-heading > div {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.branch-menu-section-heading h4 {
  overflow: hidden;
  margin: 0;
  color: var(--text);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-menu-section-heading span {
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-list-heading {
  padding: 0 2px;
}

.branch-search-control {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px;
  align-items: center;
}

.branch-search-control span {
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.branch-search-control input {
  width: 100%;
  min-height: 30px;
  border: 1px solid var(--border-control);
  border-radius: 7px;
  padding: 0 10px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: var(--font-size-compact);
}

.branch-search-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px;
}

.branch-search-clear {
  min-height: 30px;
}

.branch-search-control input:focus {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.current-branch-action-kicker {
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.branch-merge-copy {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
  line-height: 1.35;
}

.linked-submodule-field {
  display: grid;
  min-width: 0;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px;
  align-items: center;
}

.linked-submodule-summary {
  display: grid;
  min-width: 0;
  gap: 0;
  line-height: 1.25;
}

.linked-submodule-summary strong,
.linked-submodule-summary small {
  min-width: 0;
}

.linked-submodule-summary strong {
  color: var(--text);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.linked-submodule-summary small {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
}

.branch-merge-action-card .linked-submodule-summary strong,
.branch-merge-action-card .linked-submodule-summary small {
  overflow: visible;
  text-overflow: clip;
  white-space: normal;
}

.branch-merge-action-card .linked-submodule-summary {
  gap: 1px;
}

.linked-submodule-field label {
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
  white-space: nowrap;
}

.linked-submodule-field .app-dropdown {
  min-width: 0;
}

.linked-submodule-field :deep(.app-dropdown-button) {
  min-height: 28px;
  padding: 0 8px;
  font-size: var(--font-size-compact);
}

.submodule-local-branch-panel {
  display: grid;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 7px;
}

.submodule-local-branch-panel {
  border: 1px solid color-mix(in srgb, var(--border-control) 68%, transparent);
  border-radius: 7px;
  padding: 8px;
  background: color-mix(in srgb, var(--surface) 50%, transparent);
  overflow: hidden;
}

.submodule-branch-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  border-bottom: 1px solid var(--border-soft);
  padding: 0 2px 6px;
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.submodule-branch-heading > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.submodule-branch-heading h4 {
  overflow: hidden;
  margin: 0;
  color: var(--text);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.submodule-branch-heading span {
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.submodule-current-branch-switcher {
  display: grid;
  min-width: 0;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px;
  align-items: center;
}

.submodule-current-branch-switcher > span {
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.submodule-current-branch-switcher .app-dropdown {
  min-width: 0;
}

.submodule-current-branch-switcher :deep(.app-dropdown-button) {
  min-height: 28px;
  padding: 0 8px;
  font-size: var(--font-size-compact);
}

.submodule-branch-list {
  display: grid;
  min-height: 0;
  gap: 0;
  align-content: start;
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.branch-empty-state {
  border-radius: 7px;
  margin-bottom: 0;
  padding: 8px 10px;
  background: var(--surface);
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
}

.submodule-link-table {
  display: grid;
  max-height: 220px;
  gap: 5px;
  overflow: auto;
  border-radius: 7px;
  padding: 6px;
  background: color-mix(in srgb, var(--surface-soft) 76%, var(--surface));
}

.submodule-link-table-head,
.submodule-link-table-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(128px, 1fr);
  gap: 7px;
  align-items: center;
}

.submodule-link-table-head {
  padding: 0 4px 2px;
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.submodule-link-table-row {
  border: 1px solid color-mix(in srgb, var(--border-control) 58%, transparent);
  border-radius: 6px;
  padding: 5px;
  background: var(--surface);
}

.submodule-link-table-row.current {
  border-color: color-mix(in srgb, var(--focus) 48%, var(--border-control));
}

.submodule-link-parent-cell {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.submodule-link-parent-cell strong,
.submodule-link-parent-cell small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.submodule-link-parent-cell strong {
  color: var(--text);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.submodule-link-parent-cell small {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
}

.submodule-link-table .app-dropdown {
  min-width: 0;
}

.submodule-link-table :deep(.app-dropdown-button) {
  min-height: 28px;
  padding: 0 8px;
  font-size: var(--font-size-compact);
}

.submodule-branch-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 8px;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 6px 7px;
  background: color-mix(in srgb, var(--surface) 54%, transparent);
}

.submodule-branch-list li.current {
  border-color: color-mix(in srgb, var(--brand) 28%, var(--border-control));
  background: color-mix(in srgb, var(--surface-hover) 72%, transparent);
}

.submodule-branch-list li.pending {
  border-color: color-mix(in srgb, var(--focus) 42%, var(--border-control));
}

.submodule-branch-list li > div {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.submodule-branch-list .submodule-branch-controls {
  display: flex;
  gap: 5px;
  align-items: center;
  justify-content: flex-end;
}

.submodule-branch-list strong,
.submodule-branch-list small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.submodule-branch-list strong {
  color: var(--text);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.submodule-branch-list small {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
}

.branch-primary-action {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  font-size: var(--font-size-compact);
}

.branch-primary-action.pending {
  border-color: var(--focus);
}

.detail-refresh-area {
  display: flex;
  flex: 0 0 auto;
  justify-content: flex-end;
}
.detail-quick-actions :deep(.action-menu-trigger),
.branch-controls :deep(.action-menu-trigger) {
  width: 36px;
  min-height: 34px;
  padding: 0;
}

.branch-menu-panel .branch-controls :deep(.action-menu-trigger) {
  width: 32px;
  min-height: 30px;
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

.segmented-control,
.branch-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  align-content: flex-start;
}

.segmented-control button,
.branch-filters button {
  min-height: 28px;
  padding: 0 9px;
  font-size: var(--font-size-compact);
}

.branch-menu-panel .branch-filters {
  grid-column: 1 / -1;
  flex-wrap: nowrap;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.branch-menu-panel .branch-filters button {
  min-height: 26px;
  flex: 0 0 auto;
  gap: 6px;
  padding: 0 7px 0 8px;
  font-size: var(--font-size-compact);
}

.branch-filter-count {
  display: inline-grid;
  min-width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 999px;
  padding: 0 5px;
  background: var(--surface-soft);
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

button.secondary.active .branch-filter-count {
  background: color-mix(in srgb, var(--brand) 14%, var(--surface));
  color: var(--brand-text-hover);
}

.remote-branch-checkout {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  border: 0;
  border-radius: 6px;
  padding: 0;
  background: transparent;
}

.branch-list-footer {
  border-top: 1px solid var(--border-soft);
  margin-top: 2px;
  padding-top: 8px;
}

.remote-branch-checkout label {
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.remote-branch-create-row {
  display: contents;
}

.remote-branch-checkout .app-dropdown {
  min-width: 0;
}

.remote-branch-checkout :deep(.app-dropdown-button) {
  min-height: 30px;
  padding: 0 8px;
  font-size: var(--font-size-compact);
}

:deep(.remote-branch-dropdown-menu) {
  max-height: min(260px, 42vh);
  overflow-x: hidden;
  overflow-y: auto;
}

:deep(.remote-branch-dropdown-menu .app-dropdown-option) {
  display: flex;
  width: 100%;
  min-height: 34px;
  align-items: center;
  justify-content: flex-start;
  overflow: hidden;
  border-color: transparent;
  border-radius: 6px;
  padding: 0 10px;
  background: transparent;
  box-shadow: none;
  color: var(--text);
  font-size: var(--font-size-compact);
  font-weight: 750;
  line-height: 1.2;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.remote-branch-dropdown-menu .app-dropdown-option:hover:not(:disabled)),
:deep(.remote-branch-dropdown-menu .app-dropdown-option.highlighted) {
  border-color: transparent;
  background: var(--surface-hover);
  color: var(--text);
}

:deep(.remote-branch-dropdown-menu .app-dropdown-option.active) {
  background: var(--success-soft);
  color: var(--success-text);
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

.git-branches,
.git-status-group {
  display: grid;
  gap: 8px;
  border: 0;
  border-radius: 8px;
  padding: 10px;
  background: var(--surface-soft);
}

.git-status-group {
  border-left-width: 0;
}

.git-branches {
  align-content: start;
  grid-auto-rows: max-content;
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.branch-menu-panel .git-branches {
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  max-height: none;
  overflow: hidden;
  gap: 7px;
  border-radius: 7px;
  padding: 10px;
  background: var(--surface-soft);
}

.branch-list-scroll {
  display: grid;
  min-height: 0;
  gap: 7px;
  align-content: start;
  overflow: auto;
}

.git-branch-list {
  display: grid;
  gap: 0;
  align-content: start;
  grid-auto-rows: max-content;
  margin: 0;
  padding: 0;
  list-style: none;
}

.git-branch-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  border-radius: 7px;
  padding: 8px;
  background: var(--surface-soft);
}

.branch-menu-panel .git-branch-list li {
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 6px 7px;
  background: color-mix(in srgb, var(--surface) 54%, transparent);
}

.git-branch-list li.current {
  background: var(--surface-hover);
  box-shadow: none;
}

.branch-menu-panel .git-branch-list li.current {
  border-color: color-mix(in srgb, var(--brand) 28%, var(--border-control));
  background: color-mix(in srgb, var(--surface-hover) 72%, transparent);
}

.branch-menu-panel .git-branch-list li:first-child {
  padding-top: 6px;
}

.branch-menu-panel .git-branch-list li > p {
  grid-column: 1 / -1;
}

.git-branch-list strong,
.git-branch-list small {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
}

.git-branch-list strong {
  font-size: var(--font-size-base);
}

.branch-menu-panel .git-branch-list strong {
  font-size: var(--font-size-compact);
}

.branch-row-main {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.branch-row-title {
  display: flex;
  min-width: 0;
  gap: 6px;
  align-items: center;
}

.branch-row-title strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-branch-list small,
.git-branches p {
  margin-bottom: 0;
  color: var(--muted);
  font-size: var(--font-size-compact);
}

.branch-menu-panel .git-branch-list small,
.branch-menu-panel .git-branches p {
  font-size: var(--font-size-compact);
}

.branch-menu-panel .git-branch-list small {
  white-space: nowrap;
  text-overflow: ellipsis;
}

.branch-menu-panel .branch-current-marker {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 999px;
  padding: 1px 6px;
  background: var(--success-soft);
  color: var(--success-text);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.branch-menu-panel .branch-conflict-marker {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 999px;
  padding: 1px 6px;
  background: var(--danger-soft);
  color: var(--danger-text);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.branch-pending {
  border-radius: 7px;
  margin-bottom: 0;
  padding: 8px 10px;
  background: var(--warning-soft);
  color: var(--warning-text);
  font-weight: 800;
}

.branch-sync {
  max-width: 100%;
  border-radius: 999px;
  padding: 4px 8px;
  background: var(--warning-soft);
  color: var(--warning-text);
  font-size: var(--font-size-compact);
  font-weight: 900;
  white-space: nowrap;
}

.branch-menu-panel .branch-sync {
  padding: 2px 7px;
  font-size: var(--font-size-compact);
}

.branch-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
  justify-content: flex-end;
}

.branch-menu-panel .branch-controls {
  grid-column: 2;
  grid-row: 1;
  flex-wrap: nowrap;
  align-self: center;
}

.branch-sync.synced {
  background: var(--success-soft);
  color: var(--success-text);
}

.branch-action {
  min-height: 30px;
  padding: 0 10px;
  font-size: var(--font-size-compact);
}

.branch-menu-panel .branch-action {
  min-height: 26px;
  padding: 0 8px;
  font-size: var(--font-size-compact);
}

.branch-action-tooltip {
  display: inline-grid;
}

.branch-row-sync-button {
  width: 32px;
  min-width: 32px;
  min-height: 30px;
  gap: 5px;
  margin-left: 0;
  border-radius: 7px;
  padding: 0;
  font-size: var(--font-size-compact);
}

.branch-row-sync-button.synced {
  border-color: color-mix(in srgb, var(--success-text) 24%, var(--border-control));
  background: color-mix(in srgb, var(--success-soft) 34%, var(--surface));
  color: color-mix(in srgb, var(--success-text) 82%, var(--muted-strong));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--success-text) 7%, transparent);
}

.branch-row-sync-button.synced:disabled {
  cursor: default;
  opacity: 1;
}

.branch-action.pending {
  border-color: var(--focus);
}
</style>
