<script setup lang="ts">
import type { RepositorySummary } from '../repositories'
import { AppActionMenu, AppButton, AppIcon, AppMenuItem } from './ui'

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
    <AppButton class="repo-card-main" @click="$emit('open', repository)">
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
        <span class="repo-open-indicator" aria-hidden="true">
          <AppIcon name="arrow-right" />
        </span>
      </span>
      <span class="last-commit" :title="repository.error ?? repository.lastCommit">
        {{ repository.error ?? repository.lastCommit }}
      </span>
      <span class="repo-health-row">
        <span v-if="repository.error" class="health-pill error">Needs attention</span>
        <span v-if="lastRefreshedLabel" class="health-pill neutral">{{ lastRefreshedLabel }}</span>
      </span>
    </AppButton>

    <div class="repo-quick-actions" aria-label="Repository quick actions">
      <AppButton
        variant="secondary"
        size="icon"
        icon="edit"
        class="repo-icon-action"
        :aria-label="`Open ${repository.name} in editor`"
        title="Open in editor"
        @click="$emit('openInEditor', repository.path)"
      >
        Open in editor
      </AppButton>
      <AppButton
        variant="secondary"
        size="icon"
        icon="terminal"
        class="repo-icon-action"
        :aria-label="`Open ${repository.name} terminal`"
        title="Open terminal"
        @click="$emit('openInTerminal', repository.path)"
      >
        Open terminal
      </AppButton>
      <AppButton
        variant="secondary"
        size="icon"
        :icon="isPinned ? 'pin-off' : 'pin'"
        class="pin-action repo-icon-action"
        :active="isPinned"
        :aria-label="`${isPinned ? 'Unpin' : 'Pin'} ${repository.name}`"
        :title="isPinned ? 'Unpin repository' : 'Pin repository'"
        @click="$emit('togglePin', repository.path)"
      >
        {{ isPinned ? 'Unpin' : 'Pin' }}
      </AppButton>
      <AppActionMenu :label="`More actions for ${repository.name}`">
        <AppMenuItem icon="folder" @click="$emit('openInFileManager', repository.path)">
          Show in files
        </AppMenuItem>
        <AppMenuItem icon="edit" @click="$emit('openInEditor', repository.path)">
          Open in editor
        </AppMenuItem>
        <AppMenuItem icon="terminal" @click="$emit('openInTerminal', repository.path)">
          Open terminal
        </AppMenuItem>
        <AppMenuItem icon="copy" @click="$emit('copyPath', repository.path)">
          Copy path
        </AppMenuItem>
        <div class="action-menu-separator" role="separator"></div>
        <AppMenuItem icon="trash" tone="danger" @click="$emit('remove', repository.path)">
          Remove repository
        </AppMenuItem>
      </AppActionMenu>
    </div>
  </article>
</template>
