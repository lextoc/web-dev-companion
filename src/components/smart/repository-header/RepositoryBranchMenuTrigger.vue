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

<style scoped>
.branch-menu-combo {
  display: inline-flex;
  position: relative;
  min-width: 0;
  align-items: stretch;
}

.branch-menu-trigger {
  display: grid;
  min-height: 34px;
  max-width: min(320px, 28vw);
  grid-template-columns: 22px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 7px;
  border-color: color-mix(in srgb, var(--border-control) 68%, transparent);
  padding: 0 8px;
  background: color-mix(in srgb, var(--surface) 76%, transparent);
  font-size: var(--font-size-compact);
  text-align: left;
}

.branch-menu-combo .branch-menu-trigger {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.branch-menu-trigger:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--border-control) 82%, transparent);
  background: var(--surface-subtle);
}

.shortcut-label {
  display: inline-grid;
  min-width: 26px;
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
  white-space: nowrap;
}

.branch-menu-sync-button {
  display: inline-flex;
  position: relative;
  overflow: hidden;
  min-width: 106px;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-left: -1px;
  border-color: color-mix(in srgb, var(--border-control) 68%, transparent);
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  padding: 0 8px;
  background: color-mix(in srgb, var(--surface) 76%, transparent);
}

.branch-menu-sync-button.active:not(:disabled) {
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
    0 8px 18px rgba(255, 79, 139, 0.18),
    0 4px 12px rgba(67, 217, 255, 0.12),
    0 0 0 1px rgba(255, 255, 255, 0.18);
  text-shadow: 0 1px 1px rgba(14, 20, 25, 0.32);
  animation: rainbow-button-flow 8s linear infinite;
}

.branch-menu-sync-button.active:not(:disabled)::before {
  content: "";
  position: absolute;
  inset: -80% -40%;
  background: linear-gradient(
    115deg,
    transparent 30%,
    rgba(255, 255, 255, 0.42) 46%,
    transparent 62%
  );
  pointer-events: none;
  transform: translateX(-52%);
  animation: rainbow-button-sheen 2.8s ease-in-out infinite;
}

.branch-menu-trigger:focus-visible,
.branch-menu-sync-button:focus-visible,
.branch-menu-trigger:hover:not(:disabled),
.branch-menu-sync-button:hover:not(:disabled) {
  position: relative;
  z-index: 1;
}

.branch-menu-sync-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--border-control) 82%, transparent);
  background: var(--surface-subtle);
}

.branch-menu-sync-button.active:hover:not(:disabled) {
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
}

.branch-menu-sync-button :deep(.button-icon) {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
}

.branch-menu-sync-text {
  position: relative;
  z-index: 1;
  color: inherit;
  font-size: var(--font-size-compact);
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1;
  text-transform: uppercase;
}

.branch-menu-sync-shortcut {
  position: relative;
  z-index: 1;
}

.branch-menu-sync-button.pending :deep(.button-icon) {
  animation: refresh-spin 900ms linear infinite;
}

.branch-menu-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  padding: 4px;
  background: color-mix(in srgb, var(--brand) 8%, var(--surface));
  color: var(--brand-text-hover);
}

.branch-menu-summary {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;
}

.branch-menu-summary strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: var(--font-size-base);
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-menu-shortcut {
  min-width: 34px;
}

.branch-menu-kicker,
.branch-menu-meta {
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.branch-menu-title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0;
  overflow: hidden;
}

.branch-menu-meta {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
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
</style>
