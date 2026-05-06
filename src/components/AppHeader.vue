<script setup lang="ts">
import AppIcon from './AppIcon.vue'

defineProps<{
  activeRepositoryName?: string
  activeRepositoryPath?: string
  activeScriptCount: number
  commandShortcutLabel: string
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
        <div>
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
        <button
          type="button"
          class="secondary command-palette-trigger"
          title="Open command palette"
          @click="$emit('commandPalette')"
        >
          <AppIcon name="command" class="button-icon" />
          <span>Command</span>
          <kbd>{{ commandShortcutLabel }}</kbd>
        </button>
        <button type="button" class="secondary" @click="$emit('settings')">
          Settings
        </button>
      </div>
    </div>

    <slot name="repository-controls"></slot>
  </header>
</template>
