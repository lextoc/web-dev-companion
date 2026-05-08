<script setup lang="ts">
import AppButton from './AppButton.vue'

defineProps<{
  activeRepositoryName?: string
  activeRepositoryPath?: string
  activeScriptCount: number
  commandShortcutLabel: string
  settingsShortcutLabel: string
}>()

defineEmits<{
  commandPalette: []
  settings: []
}>()
</script>

<template>
  <header class="top-bar">
    <div class="app-titlebar" aria-hidden="true"></div>

    <div class="top-bar-main">
      <div class="brand-heading">
        <img src="/web-dev-companion.svg" alt="" aria-hidden="true" />
        <div class="brand-copy">
          <p class="app-product-name">Web Dev Companion</p>
          <h1>{{ activeRepositoryName ?? 'Repositories' }}</h1>
          <p class="app-context-line">
            {{ activeRepositoryPath ?? 'Local repository dashboard' }}
          </p>
        </div>
      </div>

      <div class="top-actions">
        <span v-if="activeScriptCount > 0" class="state-chip warning">
          {{ activeScriptCount }} active
        </span>
        <AppButton
          variant="secondary"
          icon="command"
          class="top-action-button command-palette-trigger"
          title="Open command palette"
          @click="$emit('commandPalette')"
        >
          Command
          <template #trailing>
            <kbd>{{ commandShortcutLabel }}</kbd>
          </template>
        </AppButton>
        <AppButton
          variant="secondary"
          class="top-action-button"
          title="Open settings"
          @click="$emit('settings')"
        >
          Settings
          <template #trailing>
            <kbd>{{ settingsShortcutLabel }}</kbd>
          </template>
        </AppButton>
      </div>
    </div>

    <slot name="repository-controls"></slot>
  </header>
</template>

<style scoped>
.top-bar {
  min-height: var(--top-bar-height);
  border-bottom: 1px solid var(--border-soft);
  background: color-mix(in srgb, var(--app-bg) 88%, var(--surface));
  box-shadow: none;
}

:global(:root[data-platform="mac"]) .top-bar {
  min-height: 92px;
}

.brand-heading {
  gap: 10px;
}

.brand-heading img {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  box-shadow: none;
}

.app-context-line {
  margin-top: 0;
  font-size: var(--font-size-compact);
}

h1 {
  font-size: var(--font-size-display);
}

.state-chip {
  height: 22px;
  padding-top: 0;
  padding-bottom: 0;
  font-size: 0.72rem;
  font-weight: 720;
  line-height: 22px;
  vertical-align: middle;
}
</style>
