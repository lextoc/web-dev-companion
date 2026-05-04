<script setup lang="ts">
import type { RepositorySummary } from '../repositories'

defineProps<{
  repository: RepositorySummary
  isPinned: boolean
}>()

defineEmits<{
  open: [repository: RepositorySummary]
  remove: [repoPath: string]
  togglePin: [repoPath: string]
}>()
</script>

<template>
  <article class="repo-card" :class="{ 'has-error': repository.error }">
    <button
      class="pin-button"
      type="button"
      :class="{ active: isPinned }"
      :aria-label="`${isPinned ? 'Unpin' : 'Pin'} ${repository.name}`"
      :title="isPinned ? 'Unpin repository' : 'Pin repository'"
      @click="$emit('togglePin', repository.path)"
    >
      {{ isPinned ? 'Pinned' : 'Pin' }}
    </button>

    <button class="repo-card-main" type="button" @click="$emit('open', repository)">
      <span class="repo-title-row">
        <strong>{{ repository.name }}</strong>
        <span class="status-pill" :class="{ dirty: repository.dirty }">
          {{ repository.dirty ? 'Changes' : 'Clean' }}
        </span>
      </span>
      <span class="repo-path">{{ repository.path }}</span>
      <span class="repo-meta">
        <span>{{ repository.branch }}</span>
        <span>{{ repository.npmScriptCount }} scripts</span>
      </span>
      <span class="last-commit">{{ repository.error ?? repository.lastCommit }}</span>
    </button>

    <button
      class="icon-button"
      type="button"
      :aria-label="`Remove ${repository.name}`"
      title="Remove"
      @click="$emit('remove', repository.path)"
    >
      x
    </button>
  </article>
</template>
