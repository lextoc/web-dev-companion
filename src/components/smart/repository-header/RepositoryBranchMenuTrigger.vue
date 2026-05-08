<script setup lang="ts">
import type { RepositoryDetails } from "../../../repositories";
import { AppIcon } from "../../ui";
import {
  branchSyncActionIcon,
  branchSyncActionLabel,
  branchSyncDisabledReason,
  branchSyncTitle,
  isBranchSyncActionReady,
  isSyncingBranch,
} from "./branchUtils";

defineProps<{
  branchMenuLabel: string;
  branchShortcutLabel: string;
  commitCelebrations: boolean;
  currentBranch?: RepositoryDetails["gitBranches"][number];
  currentBranchSyncLabel: string;
  deletingBranchName: string | null;
  isBranchMenuOpen: boolean;
  selectedDetails: RepositoryDetails;
  syncConfettiBursts: Array<{ id: number }>;
  syncShortcutLabel: string;
  syncingBranchName: string | null;
}>();

defineEmits<{
  syncBranch: [branchName: string];
  toggleMenu: [];
}>();
</script>

<template>
  <div class="branch-menu-combo">
    <button
      type="button"
      class="secondary branch-menu-trigger"
      :aria-label="branchMenuLabel"
      :aria-expanded="isBranchMenuOpen"
      aria-controls="branch-management-menu"
      :title="branchMenuLabel"
      @click="$emit('toggleMenu')"
    >
      <AppIcon name="repository" class="branch-menu-icon" />
      <span class="branch-menu-summary">
        <span class="branch-menu-kicker">Branch</span>
        <span class="branch-menu-title-row">
          <strong>{{ selectedDetails.branch }}</strong>
        </span>
        <span class="branch-menu-meta">{{ currentBranchSyncLabel }}</span>
      </span>
      <kbd class="shortcut-label branch-menu-shortcut">{{ branchShortcutLabel }}</kbd>
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
</template>
