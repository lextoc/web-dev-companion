<script setup lang="ts">
import type { RepositorySummary } from '../repositories'

defineProps<{
  repository: RepositorySummary
  isPinned: boolean
  runningScriptCount: number
  lastRefreshedLabel: string
}>()

defineEmits<{
  open: [repository: RepositorySummary]
  remove: [repoPath: string]
  togglePin: [repoPath: string]
  copyPath: [repoPath: string]
  openInEditor: [repoPath: string]
  openInFileManager: [repoPath: string]
  openInTerminal: [repoPath: string]
}>()
</script>

<template>
  <article class="repo-card" :class="{ 'has-error': repository.error, pinned: isPinned }">
    <button class="repo-card-main" type="button" @click="$emit('open', repository)">
      <span class="repo-title-row">
        <span class="repo-title-stack">
          <strong>{{ repository.name }}</strong>
          <span class="repo-path">{{ repository.path }}</span>
        </span>
        <span class="repo-card-badges">
          <span class="status-pill" :class="{ dirty: repository.dirty }">
            {{ repository.dirty ? 'Changes' : 'Clean' }}
          </span>
          <span class="branch-pill">{{ repository.branch }}</span>
          <span class="branch-pill">{{ repository.npmScriptCount }} scripts</span>
          <span v-if="runningScriptCount > 0" class="health-running">
            {{ runningScriptCount }} running
          </span>
        </span>
      </span>
      <span class="last-commit">{{ repository.error ?? repository.lastCommit }}</span>
      <span class="repo-health-row">
        <span v-if="repository.error" class="health-pill error">Needs attention</span>
        <span v-if="isPinned" class="health-pill neutral">Pinned</span>
        <span v-if="lastRefreshedLabel" class="health-pill neutral">{{ lastRefreshedLabel }}</span>
      </span>
    </button>

    <div class="repo-quick-actions" aria-label="Repository quick actions">
      <button
        type="button"
        class="secondary pin-action"
        :class="{ active: isPinned }"
        :aria-label="`${isPinned ? 'Unpin' : 'Pin'} ${repository.name}`"
        :title="isPinned ? 'Unpin repository' : 'Pin repository'"
        @click="$emit('togglePin', repository.path)"
      >
        {{ isPinned ? 'Unpin' : 'Pin' }}
      </button>
      <button type="button" class="secondary" @click="$emit('openInFileManager', repository.path)">
        Files
      </button>
      <button type="button" class="secondary" @click="$emit('openInEditor', repository.path)">
        Editor
      </button>
      <button type="button" class="secondary" @click="$emit('openInTerminal', repository.path)">
        Terminal
      </button>
      <button type="button" class="secondary" @click="$emit('copyPath', repository.path)">
        Copy path
      </button>
    </div>

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
