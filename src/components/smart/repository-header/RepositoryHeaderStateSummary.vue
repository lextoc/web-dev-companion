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
  const count = props.selectedDetails.npmScriptCount;

  return count === 1 ? "1 script" : `${count} scripts`;
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
