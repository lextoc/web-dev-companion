<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { RepositoryDetails } from "../repositories";
import ActionMenu from "./ActionMenu.vue";
import AppDropdown from "./AppDropdown.vue";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  selectedDetails: RepositoryDetails | null;
  isDetailLoading: boolean;
  autoRefreshLabel: string;
  autoRefreshProgress: number;
  commitCelebrations: boolean;
  syncShortcutLabel: string;
  syncingBranchName: string | null;
  deletingBranchName: string | null;
  checkingOutBranchName: string | null;
  branchFeedbackMessages: Record<string, string>;
}>();

const emit = defineEmits<{
  back: [];
  refresh: [];
  deleteBranch: [branchName: string];
  checkoutBranch: [branchName: string];
  checkoutRemoteBranch: [remoteBranchName: string];
  syncBranch: [branchName: string];
  copyPath: [repoPath: string];
  openInEditor: [repoPath: string];
  openInFileManager: [repoPath: string];
  openInTerminal: [repoPath: string];
}>();

const branchFilter = ref("all");
const selectedRemoteBranchName = ref("");
const isBranchMenuOpen = ref(false);
const branchMenuElement = ref<HTMLElement | null>(null);
const refreshButtonElement = ref<HTMLElement | null>(null);
const isRefreshIconSettling = ref(false);
const refreshIconStartAngle = ref(0);
const refreshIconEndAngle = ref(0);
const refreshIconSettleDuration = ref(0);
let refreshIconSettleTimer: number | undefined;

const branchFilters = [
  { key: "all", label: "All" },
  { key: "behind", label: "Behind" },
  { key: "ahead", label: "Ahead" },
  { key: "no-upstream", label: "No upstream" },
  { key: "in-sync", label: "In sync" },
];

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
const currentBranch = computed(() =>
  props.selectedDetails?.gitBranches.find((branch) => branch.current),
);
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
    selectedRemoteBranchName.value = "";
    isBranchMenuOpen.value = false;
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

function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node;

  if (target instanceof Element && target.closest(".app-dropdown-menu")) {
    return;
  }

  if (!branchMenuElement.value?.contains(target)) {
    isBranchMenuOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);

  if (refreshIconSettleTimer !== undefined) {
    window.clearTimeout(refreshIconSettleTimer);
  }
});
</script>

<template>
  <div class="detail-command-bar">
    <nav class="detail-nav" aria-label="Repository detail navigation">
      <button type="button" class="secondary detail-back-button" @click="$emit('back')">
        <AppIcon name="arrow-left" class="button-icon" />
        <span>Back</span>
      </button>

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
      <div ref="branchMenuElement" class="branch-menu">
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
            <kbd class="shortcut-label branch-menu-sync-shortcut">{{ syncShortcutLabel }}</kbd>
            <span class="visually-hidden">{{ branchSyncActionLabel(currentBranch) }}</span>
          </button>
        </div>

        <div
          v-if="isBranchMenuOpen"
          id="branch-management-menu"
          class="branch-menu-popover"
          role="dialog"
          aria-label="Branch management"
          @keydown.esc.stop.prevent="isBranchMenuOpen = false"
        >
          <section class="branch-menu-panel">
            <div class="panel-heading">
              <div>
                <h3>Branches</h3>
                <span class="panel-subtitle">{{ selectedDetails.branch }} - {{ currentBranchSyncLabel }}</span>
              </div>
              <button
                type="button"
                class="secondary subtle-icon-button branch-menu-close"
                aria-label="Close branch menu"
                title="Close"
                @click="isBranchMenuOpen = false"
              >
                <AppIcon name="close" class="button-icon" />
                <span class="visually-hidden">Close</span>
              </button>
            </div>

            <section
              v-if="currentBranch"
              class="current-branch-action-card"
              aria-label="Current branch sync action"
            >
              <div class="current-branch-action-copy">
                <span class="current-branch-action-kicker">Current branch</span>
                <strong>{{ currentBranch.name }}</strong>
                <small>{{ currentBranch.upstream ?? "No upstream configured" }}</small>
                <span class="branch-sync" :class="{ synced: currentBranch.inSyncWithRemote }">
                  {{ branchSyncLabel(currentBranch) }}
                </span>
              </div>
              <button
                v-if="!currentBranch.inSyncWithRemote"
                type="button"
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
                <AppIcon name="restart" class="button-icon" />
                <span>
                  {{
                    isSyncingBranch(currentBranch.name, syncingBranchName)
                      ? `${branchSyncActionLabel(currentBranch)}ing...`
                      : branchSyncActionLabel(currentBranch)
                  }}
                </span>
              </button>
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

            <div class="git-branches">
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
                  <button
                    type="submit"
                    class="secondary branch-action"
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
                  </button>
                </div>
              </form>

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
                    <strong>{{ branch.name }}</strong>
                    <small>
                      {{ branch.upstream ?? "No upstream" }}
                    </small>
                    <small v-if="branch.current" class="branch-current-marker">Current branch</small>
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
                      v-if="!branch.current"
                      type="button"
                      class="secondary branch-action"
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
                    </button>
                    <ActionMenu
                      v-if="!branch.inSyncWithRemote || !branch.current"
                      :label="`More actions for ${branch.name}`"
                    >
                      <button
                        v-if="!branch.inSyncWithRemote"
                        type="button"
                        class="action-menu-item"
                        role="menuitem"
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
                        <AppIcon name="restart" class="button-icon" />
                        <span>
                          {{
                            isSyncingBranch(branch.name, syncingBranchName)
                              ? `${branchSyncActionLabel(branch)}ing...`
                              : branchSyncActionLabel(branch)
                          }}
                        </span>
                      </button>
                      <button
                        v-if="!branch.current"
                        type="button"
                        class="action-menu-item danger"
                        role="menuitem"
                        :class="{ pending: isDeletingBranch(branch.name, deletingBranchName) }"
                        :disabled="
                          !branch.canDelete || Boolean(syncingBranchName) || Boolean(deletingBranchName)
                        "
                        :title="branch.deleteReason ?? 'Delete local branch'"
                        @click="$emit('deleteBranch', branch.name)"
                      >
                        <AppIcon name="trash" class="button-icon" />
                        <span>
                          {{ isDeletingBranch(branch.name, deletingBranchName) ? "Removing..." : "Remove branch" }}
                        </span>
                      </button>
                    </ActionMenu>
                  </div>
                </li>
              </ul>

              <p v-else>No branches match this filter.</p>
            </div>
          </section>
        </div>
      </div>

      <div class="detail-quick-actions" aria-label="Repository quick actions">
        <button
          type="button"
          class="secondary subtle-icon-button"
          :aria-label="`Show ${selectedDetails.name} in files`"
          title="Show in files"
          @click="$emit('openInFileManager', selectedDetails.path)"
        >
          <AppIcon name="folder" class="button-icon" />
          <span class="visually-hidden">Show in files</span>
        </button>
        <button
          type="button"
          class="secondary subtle-icon-button"
          :aria-label="`Open ${selectedDetails.name} in editor`"
          title="Open in editor"
          @click="$emit('openInEditor', selectedDetails.path)"
        >
          <AppIcon name="edit" class="button-icon" />
          <span class="visually-hidden">Open in editor</span>
        </button>
        <button
          type="button"
          class="secondary subtle-icon-button"
          :aria-label="`Open ${selectedDetails.name} terminal`"
          title="Open terminal"
          @click="$emit('openInTerminal', selectedDetails.path)"
        >
          <AppIcon name="terminal" class="button-icon" />
          <span class="visually-hidden">Open terminal</span>
        </button>
        <button
          type="button"
          class="secondary subtle-icon-button"
          :aria-label="`Copy path for ${selectedDetails.name}`"
          title="Copy path"
          @click="$emit('copyPath', selectedDetails.path)"
        >
          <AppIcon name="copy" class="button-icon" />
          <span class="visually-hidden">Copy path</span>
        </button>
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
