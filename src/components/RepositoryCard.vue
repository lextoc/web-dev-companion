<script setup lang="ts">
import type { RepositorySummary } from '../repositories'
import ActionMenu from './ActionMenu.vue'
import AppIcon from './AppIcon.vue'

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
  <article
    class="repo-card"
    :class="{
      'has-error': repository.error,
      'has-running-scripts': runningScriptCount > 0,
      pinned: isPinned,
    }"
  >
    <button class="repo-card-main" type="button" @click="$emit('open', repository)">
      <span class="repo-title-row">
        <span class="repo-title-stack">
          <strong :title="repository.name">{{ repository.name }}</strong>
          <span class="repo-path" :title="repository.path">{{ repository.path }}</span>
        </span>
        <span class="repo-card-badges">
          <span class="status-pill" :class="{ dirty: repository.dirty }">
            {{ repository.dirty ? 'Changes' : 'Clean' }}
          </span>
          <span class="branch-pill branch-name" :title="repository.branch">{{ repository.branch }}</span>
          <span class="branch-pill script-count">{{ repository.npmScriptCount }} scripts</span>
          <span v-if="runningScriptCount > 0" class="health-running">
            {{ runningScriptCount }} running
          </span>
        </span>
      </span>
      <span class="last-commit" :title="repository.error ?? repository.lastCommit">
        {{ repository.error ?? repository.lastCommit }}
      </span>
      <span class="repo-health-row">
        <span v-if="repository.error" class="health-pill error">Needs attention</span>
        <span v-if="lastRefreshedLabel" class="health-pill neutral">{{ lastRefreshedLabel }}</span>
      </span>
    </button>

    <div class="repo-quick-actions" aria-label="Repository quick actions">
      <button
        type="button"
        class="secondary repo-icon-action"
        :aria-label="`Open ${repository.name} in editor`"
        title="Open in editor"
        @click="$emit('openInEditor', repository.path)"
      >
        <AppIcon name="edit" class="button-icon" />
        <span class="visually-hidden">Open in editor</span>
      </button>
      <button
        type="button"
        class="secondary repo-icon-action"
        :aria-label="`Open ${repository.name} terminal`"
        title="Open terminal"
        @click="$emit('openInTerminal', repository.path)"
      >
        <AppIcon name="terminal" class="button-icon" />
        <span class="visually-hidden">Open terminal</span>
      </button>
      <button
        type="button"
        class="secondary pin-action repo-icon-action"
        :class="{ active: isPinned }"
        :aria-label="`${isPinned ? 'Unpin' : 'Pin'} ${repository.name}`"
        :title="isPinned ? 'Unpin repository' : 'Pin repository'"
        @click="$emit('togglePin', repository.path)"
      >
        <AppIcon :name="isPinned ? 'pin-off' : 'pin'" class="button-icon" />
        <span class="visually-hidden">{{ isPinned ? 'Unpin' : 'Pin' }}</span>
      </button>
      <ActionMenu :label="`More actions for ${repository.name}`">
        <button type="button" class="action-menu-item" role="menuitem" @click="$emit('openInFileManager', repository.path)">
          <AppIcon name="folder" class="button-icon" />
          <span>Show in files</span>
        </button>
        <button type="button" class="action-menu-item" role="menuitem" @click="$emit('openInEditor', repository.path)">
          <AppIcon name="edit" class="button-icon" />
          <span>Open in editor</span>
        </button>
        <button type="button" class="action-menu-item" role="menuitem" @click="$emit('openInTerminal', repository.path)">
          <AppIcon name="terminal" class="button-icon" />
          <span>Open terminal</span>
        </button>
        <button type="button" class="action-menu-item" role="menuitem" @click="$emit('copyPath', repository.path)">
          <AppIcon name="copy" class="button-icon" />
          <span>Copy path</span>
        </button>
        <div class="action-menu-separator" role="separator"></div>
        <button type="button" class="action-menu-item danger" role="menuitem" @click="$emit('remove', repository.path)">
          <AppIcon name="trash" class="button-icon" />
          <span>Remove repository</span>
        </button>
      </ActionMenu>
    </div>
  </article>
</template>
