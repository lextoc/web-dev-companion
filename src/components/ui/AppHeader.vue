<script setup lang="ts">
import AppButton from './AppButton.vue'

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
        <AppButton
          variant="secondary"
          icon="command"
          class="command-palette-trigger"
          title="Open command palette"
          @click="$emit('commandPalette')"
        >
          Command
          <template #trailing>
            <kbd>{{ commandShortcutLabel }}</kbd>
          </template>
        </AppButton>
        <AppButton variant="secondary" @click="$emit('settings')">
          Settings
        </AppButton>
      </div>
    </div>

    <slot name="repository-controls"></slot>
  </header>
</template>
