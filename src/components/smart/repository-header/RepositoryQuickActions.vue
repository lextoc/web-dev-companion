<script setup lang="ts">
import { AppButton } from "../../ui";

defineProps<{
  repositoryName: string;
  repositoryPath: string;
}>();

defineEmits<{
  copyPath: [repoPath: string];
  openInEditor: [repoPath: string];
  openInFileManager: [repoPath: string];
  openInTerminal: [repoPath: string];
}>();
</script>

<template>
  <div class="detail-quick-actions" aria-label="Repository quick actions">
    <AppButton
      variant="secondary"
      size="icon"
      icon="folder"
      :aria-label="`Show ${repositoryName} in files`"
      title="Show in files"
      @click="$emit('openInFileManager', repositoryPath)"
    >
      Show in files
    </AppButton>
    <AppButton
      variant="secondary"
      size="icon"
      icon="edit"
      :aria-label="`Open ${repositoryName} in editor`"
      title="Open in editor"
      @click="$emit('openInEditor', repositoryPath)"
    >
      Open in editor
    </AppButton>
    <AppButton
      variant="secondary"
      size="icon"
      icon="terminal"
      :aria-label="`Open ${repositoryName} terminal`"
      title="Open terminal"
      @click="$emit('openInTerminal', repositoryPath)"
    >
      Open terminal
    </AppButton>
    <AppButton
      variant="secondary"
      size="icon"
      icon="copy"
      :aria-label="`Copy path for ${repositoryName}`"
      title="Copy path"
      @click="$emit('copyPath', repositoryPath)"
    >
      Copy path
    </AppButton>
  </div>
</template>

<style scoped>
.detail-quick-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.detail-quick-actions button {
  min-height: 32px;
  padding: 0 10px;
  font-size: var(--font-size-compact);
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

.detail-quick-actions .subtle-icon-button {
  width: 36px;
  min-height: 36px;
  padding: 0;
}
</style>
