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
      'has-changes': repository.dirty,
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

<style scoped>
.repo-card {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  border-radius: 8px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface) 94%, #fff),
      color-mix(in srgb, var(--surface-soft) 34%, var(--surface))
    );
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, #fff 56%, transparent),
    0 1px 2px rgba(23, 32, 42, 0.08);
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease,
    transform 140ms ease;
}

.repo-card::after {
  position: absolute;
  inset: 0;
  z-index: 3;
  border: 2px solid transparent;
  border-radius: inherit;
  pointer-events: none;
  content: "";
}

.repo-card:hover,
.repo-card:focus-within {
  border-color: var(--brand);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, #fff 58%, transparent),
    0 8px 18px rgba(23, 32, 42, 0.12);
  transform: translateY(-1px);
}

.repo-card:hover::after,
.repo-card:focus-within::after {
  border-color: var(--brand);
}

.repo-card.has-error {
  border-color: color-mix(in srgb, var(--danger-text) 22%, var(--border));
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--danger-soft) 34%, var(--surface)),
      color-mix(in srgb, var(--danger-soft) 18%, var(--surface))
    );
}

.repo-card.has-changes {
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--warning-soft) 48%, transparent),
      transparent 46%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface) 94%, #fff),
      color-mix(in srgb, var(--surface-soft) 34%, var(--surface))
    );
}

.repo-card.pinned {
  border-width: 2px;
  border-color: var(--success-text);
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--success-soft) 36%, transparent),
      transparent 46%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface) 94%, #fff),
      color-mix(in srgb, var(--surface-soft) 34%, var(--surface))
    );
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--success-text) 30%, transparent),
    inset 0 1px 0 color-mix(in srgb, #fff 56%, transparent),
    0 1px 2px rgba(23, 32, 42, 0.08);
}

.repo-card.pinned::after {
  border-color: var(--success-text);
}

.repo-card.pinned .repo-quick-actions {
  border-left-color: color-mix(in srgb, var(--border-soft) 82%, var(--success-text));
}

.repo-card.pinned.has-changes {
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--warning-soft) 48%, transparent),
      transparent 46%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface) 94%, #fff),
      color-mix(in srgb, var(--surface-soft) 34%, var(--surface))
    );
}

.repo-card.pinned:hover,
.repo-card.pinned:focus-within {
  border-color: var(--success-text);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--success-text) 34%, transparent),
    inset 0 1px 0 color-mix(in srgb, #fff 58%, transparent),
    0 8px 18px rgba(23, 32, 42, 0.12);
}

.repo-card.pinned:hover::after,
.repo-card.pinned:focus-within::after {
  border-color: var(--success-text);
}

.repo-card.has-error:hover,
.repo-card.has-error:focus-within {
  border-color: var(--danger-text);
}

.repo-card.has-error:hover::after,
.repo-card.has-error:focus-within::after {
  border-color: var(--danger-text);
}

.repo-card.has-running-scripts::before {
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 0;
  width: 3px;
  border-radius: 0 999px 999px 0;
  background: var(--warning-text);
  content: "";
}

.repo-card-main {
  display: grid;
  gap: 8px;
  min-height: 102px;
  border: 0;
  border-radius: 8px;
  padding: 12px 14px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-weight: 400;
  text-align: left;
}

.repo-card-main:hover:not(:disabled) {
  border-color: transparent;
  background: var(--surface-hover);
  color: var(--text);
  box-shadow: none;
}

.repo-title-row {
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.repo-title-stack {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.repo-title-row strong {
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-title);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-path,
.last-commit {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-path {
  margin-bottom: 0;
  color: var(--muted);
  font-size: var(--font-size-compact);
}

.repo-card-badges {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
  max-width: min(520px, 52%);
}

.repo-open-indicator {
  display: inline-grid;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--border-control) 72%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  color: var(--muted-strong);
  transition:
    background-color 140ms ease,
    border-color 140ms ease,
    color 140ms ease,
    transform 140ms ease;
}

.repo-open-indicator :deep(.app-icon) {
  width: 16px;
  height: 16px;
}

.repo-card-main:hover:not(:disabled) .repo-open-indicator,
.repo-card-main:focus-visible .repo-open-indicator {
  border-color: var(--brand);
  background: var(--brand);
  color: var(--brand-contrast);
  transform: translateX(2px);
}

.health-running {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 23px;
  border: 1px solid color-mix(in srgb, var(--warning-text) 24%, transparent);
  border-radius: 999px;
  padding: 0 9px;
  background:
    linear-gradient(180deg, color-mix(in srgb, #fff 36%, transparent), transparent),
    color-mix(in srgb, var(--warning-soft) 82%, var(--surface));
  color: var(--warning-text);
  font-size: 0.72rem;
  font-weight: 720;
  line-height: 23px;
  vertical-align: middle;
  white-space: nowrap;
}

.health-running::before {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 12%, transparent);
  content: "";
}

.last-commit {
  color: var(--muted-strong);
  font-size: var(--font-size-base);
}

.repo-health-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.health-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 23px;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0 9px;
  font-size: 0.72rem;
  font-weight: 720;
  line-height: 23px;
  vertical-align: middle;
  white-space: nowrap;
}

.health-pill::before {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.72;
  content: "";
}

.health-pill.error {
  border-color: color-mix(in srgb, var(--danger-text) 20%, transparent);
  background: color-mix(in srgb, var(--danger-soft) 86%, var(--surface));
  color: var(--danger-text);
}

.health-pill.neutral {
  border-color: color-mix(in srgb, var(--border) 72%, transparent);
  background: color-mix(in srgb, var(--surface-subtle) 64%, var(--surface));
  color: var(--muted-strong);
}

.repo-quick-actions {
  display: grid;
  grid-template-columns: repeat(4, 34px);
  gap: 7px;
  align-content: center;
  align-items: center;
  border-left: 1px solid color-mix(in srgb, var(--border-soft) 70%, transparent);
  padding: 12px 14px 12px 8px;
  background: color-mix(in srgb, var(--surface-soft) 48%, transparent);
}

.repo-quick-actions > button,
.repo-quick-actions :deep(.action-menu-trigger) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 10px;
  font-size: var(--font-size-compact);
  white-space: nowrap;
}

.repo-quick-actions .repo-icon-action,
.repo-quick-actions :deep(.action-menu-trigger) {
  width: 34px;
  padding: 0;
}

.repo-quick-actions :deep(.action-menu) {
  min-width: 0;
}

.repo-quick-actions :deep(.action-menu-trigger) {
  width: 100%;
}

.repo-quick-actions .pin-action.active {
  border-color: var(--brand);
  background: var(--surface-subtle);
  color: var(--brand-text-hover);
}

.status-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  height: 23px;
  border: 1px solid color-mix(in srgb, var(--success-text) 20%, transparent);
  border-radius: 999px;
  padding: 0 9px;
  background:
    linear-gradient(180deg, color-mix(in srgb, #fff 36%, transparent), transparent),
    color-mix(in srgb, var(--success-soft) 86%, var(--surface));
  color: var(--success-text);
  font-size: 0.72rem;
  font-weight: 720;
  line-height: 23px;
  vertical-align: middle;
  white-space: nowrap;
}

.status-pill::before {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 10%, transparent);
  content: "";
}

.status-pill.dirty {
  border-color: color-mix(in srgb, var(--warning-text) 24%, transparent);
  background:
    linear-gradient(180deg, color-mix(in srgb, #fff 36%, transparent), transparent),
    color-mix(in srgb, var(--warning-soft) 86%, var(--surface));
  color: var(--warning-text);
}

.branch-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 23px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  border-radius: 999px;
  padding: 0 9px;
  background:
    linear-gradient(180deg, color-mix(in srgb, #fff 34%, transparent), transparent),
    color-mix(in srgb, var(--surface-subtle) 58%, var(--surface));
  color: var(--muted-strong);
  font-size: 0.72rem;
  font-weight: 720;
  line-height: 23px;
  vertical-align: middle;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-pill::before {
  flex: 0 0 auto;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--muted-strong) 76%, transparent);
  content: "";
}

.branch-pill.branch-name {
  color: color-mix(in srgb, var(--brand) 68%, var(--muted-strong));
}

.branch-pill.branch-name::before {
  background: var(--brand);
}

.branch-pill.script-count {
  color: color-mix(in srgb, var(--info-text) 68%, var(--muted-strong));
}

.branch-pill.script-count::before {
  background: var(--info-text);
}

.repo-card {
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface) 86%, var(--app-bg)),
      color-mix(in srgb, var(--surface-soft) 58%, var(--surface))
    );
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, #fff 42%, transparent),
    0 1px 2px rgba(23, 32, 42, 0.08);
}

.repo-card:hover,
.repo-card:focus-within {
  border-color: var(--brand);
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface) 92%, var(--app-bg)),
      color-mix(in srgb, var(--surface-hover) 42%, var(--surface))
    );
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, #fff 44%, transparent),
    0 8px 18px rgba(23, 32, 42, 0.12);
}

.repo-card.has-changes {
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--warning-soft) 50%, transparent),
      transparent 46%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface) 86%, var(--app-bg)),
      color-mix(in srgb, var(--surface-soft) 58%, var(--surface))
    );
}

.repo-card.pinned {
  border-width: 2px;
  border-color: var(--success-text);
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--success-soft) 42%, transparent),
      transparent 46%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface) 86%, var(--app-bg)),
      color-mix(in srgb, var(--surface-soft) 58%, var(--surface))
    );
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--success-text) 20%, transparent),
    inset 0 1px 0 color-mix(in srgb, #fff 42%, transparent),
    0 1px 2px rgba(23, 32, 42, 0.08);
}

.repo-card.pinned .repo-quick-actions {
  border-left-color: color-mix(in srgb, var(--border-soft) 82%, var(--success-text));
}

.repo-card.pinned.has-changes {
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--warning-soft) 50%, transparent),
      transparent 46%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface) 86%, var(--app-bg)),
      color-mix(in srgb, var(--surface-soft) 58%, var(--surface))
    );
}

.repo-card.pinned:hover,
.repo-card.pinned:focus-within {
  border-color: var(--success-text);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--success-text) 24%, transparent),
    inset 0 1px 0 color-mix(in srgb, #fff 44%, transparent),
    0 8px 18px rgba(23, 32, 42, 0.12);
}

.repo-card.has-error {
  border-color: color-mix(in srgb, var(--danger-text) 22%, var(--border));
  background: color-mix(in srgb, var(--danger-soft) 32%, transparent);
  box-shadow: none;
}

.repo-card.has-error:hover,
.repo-card.has-error:focus-within {
  border-color: var(--danger-text);
}

.repo-card-main {
  min-height: 82px;
  border-radius: 0;
  gap: 6px;
  padding: 10px 12px 10px 16px;
}

.repo-card-main:hover:not(:disabled) {
  background: color-mix(in srgb, var(--surface-hover) 68%, transparent);
  box-shadow: none;
}

.repo-quick-actions {
  gap: 6px;
  border-left: 1px solid color-mix(in srgb, var(--border-soft) 62%, transparent);
  padding: 0 12px 0 6px;
  background: color-mix(in srgb, var(--surface-soft) 38%, transparent);
  box-shadow: none;
}

.repo-quick-actions > button,
.repo-quick-actions :deep(.action-menu-trigger) {
  min-height: 32px;
  padding: 0 9px;
}

.repo-quick-actions .repo-icon-action,
.repo-quick-actions :deep(.action-menu-trigger) {
  padding: 0;
}

.repo-card-badges {
  gap: 5px;
  max-width: min(360px, 44%);
}

.repo-path,
.last-commit {
  overflow: hidden;
  font-size: var(--font-size-compact);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-pill {
  height: 22px;
  padding-top: 0;
  padding-bottom: 0;
  font-size: 0.72rem;
  font-weight: 720;
  line-height: 22px;
  vertical-align: middle;
}

@media (max-width: 1180px) {
  .repo-quick-actions {
    border-top: 1px solid color-mix(in srgb, var(--border-soft) 62%, transparent);
    border-left: 0;
  }
}

@media (max-width: 760px) {
  .repo-card {
    grid-template-columns: 1fr;
  }

  .repo-card-main {
    min-height: 0;
  }

  .repo-title-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .repo-title-stack {
    flex: 1 1 calc(100% - 44px);
  }

  .repo-card-badges {
    order: 3;
    flex: 1 1 100%;
    justify-content: flex-start;
    max-width: 100%;
  }

  .repo-quick-actions {
    grid-template-columns: repeat(4, 34px);
    justify-content: start;
    width: auto;
    border-top: 0;
    border-left: 0;
    padding: 10px;
  }
}

@media (min-width: 761px) and (max-width: 1180px) {
  .repo-card {
    grid-template-columns: 1fr;
  }

  .repo-quick-actions {
    grid-template-columns: repeat(4, 34px);
    justify-content: start;
    width: auto;
    border-top: 0;
    border-left: 0;
    padding: 10px;
  }
}
</style>
