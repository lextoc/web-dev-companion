<script setup lang="ts">
import { computed } from "vue";
import type { RepositoryDetails } from "../../../repositories";

const props = defineProps<{
  selectedDetails: RepositoryDetails;
}>();

const changedFileCount = computed(() => {
  const gitStatus = props.selectedDetails.gitStatus;

  return (
    gitStatus.staged.length +
    gitStatus.unstaged.length +
    gitStatus.untracked.length +
    gitStatus.conflicted.length
  );
});

const changedFileLabel = computed(() => {
  if (changedFileCount.value === 0) {
    return "Clean tree";
  }

  return changedFileCount.value === 1 ? "1 changed file" : `${changedFileCount.value} changed files`;
});

const scriptCountLabel = computed(() => {
  const count = props.selectedDetails.taskCount;

  return count === 1 ? "1 task" : `${count} tasks`;
});
</script>

<template>
  <div class="detail-context-pills" aria-label="Repository state">
    <div class="detail-state-summary" aria-label="Repository summary">
      <span class="detail-state-item" :class="{ warning: changedFileCount > 0 }">
        {{ changedFileLabel }}
      </span>
      <span class="detail-state-item">{{ scriptCountLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.detail-context-pills {
  display: flex;
  position: relative;
  min-width: 0;
  flex: 0 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.detail-state-summary {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.detail-state-item {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0 9px;
  background: color-mix(in srgb, var(--surface) 28%, transparent);
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  white-space: nowrap;
}

.detail-state-item.warning {
  border-color: color-mix(in srgb, var(--warning) 28%, transparent);
  background: color-mix(in srgb, var(--warning-soft) 72%, transparent);
  color: var(--warning-text);
}

@media (max-width: 760px) {
  .detail-context-pills,
  .detail-state-summary {
    width: 100%;
    max-width: none;
  }

  .detail-state-item {
    flex: 1 1 0;
    justify-content: center;
  }
}
</style>
