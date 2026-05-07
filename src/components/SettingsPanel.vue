<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import {
  AUTO_REFRESH_INTERVAL_OPTIONS,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type ThemeMode,
} from '../settings'
import { AppButton, AppCheckbox, AppDropdown } from './ui'

const props = defineProps<{
  settings: AppSettings
}>()

const emit = defineEmits<{
  close: []
  save: [settings: AppSettings]
}>()

const draft = reactive<AppSettings>({ ...props.settings })
const autoRefreshIntervalModel = computed({
  get: () => draft.autoRefreshIntervalMs,
  set: (value: string | number) => {
    draft.autoRefreshIntervalMs = Number(value) || DEFAULT_APP_SETTINGS.autoRefreshIntervalMs
  },
})
const themeModeModel = computed({
  get: () => draft.themeMode,
  set: (value: string | number) => {
    if (value === 'system' || value === 'light' || value === 'dark') {
      draft.themeMode = value
    }
  },
})

watch(
  () => props.settings,
  (settings) => {
    Object.assign(draft, settings)
  },
)

function saveSettings() {
  emit('save', {
    autoRefreshIntervalMs: Number(draft.autoRefreshIntervalMs) || DEFAULT_APP_SETTINGS.autoRefreshIntervalMs,
    commitCelebrations: draft.commitCelebrations,
    editorCommand: draft.editorCommand.trim() || DEFAULT_APP_SETTINGS.editorCommand,
    skipBranchSyncConfirmation: draft.skipBranchSyncConfirmation,
    themeMode: draft.themeMode,
  })
}

const themeOptions: Array<{ label: string; value: ThemeMode }> = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]
const autoRefreshOptions = AUTO_REFRESH_INTERVAL_OPTIONS.map((option) => ({ ...option }))
</script>

<template>
  <div class="modal-backdrop" role="presentation" @click.self="$emit('close')">
    <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div>
        <p class="eyebrow">Preferences</p>
        <h2 id="settings-title">Settings</h2>
      </div>

      <label>
        <span>Auto refresh</span>
        <AppDropdown
          id="settings-auto-refresh"
          v-model="autoRefreshIntervalModel"
          :options="autoRefreshOptions"
        />
      </label>

      <label>
        <span>Theme</span>
        <AppDropdown id="settings-theme" v-model="themeModeModel" :options="themeOptions" />
      </label>

      <AppCheckbox
        v-model="draft.commitCelebrations"
        description="Rainbow commit and sync buttons, plus confetti on successful submit."
      >
        Commit celebrations
      </AppCheckbox>

      <AppCheckbox
        v-model="draft.skipBranchSyncConfirmation"
        description="Run branch push and pull actions without asking first."
      >
        Skip sync confirmation
      </AppCheckbox>

      <label>
        <span>Editor command</span>
        <input v-model="draft.editorCommand" type="text" autocomplete="off" placeholder="code" />
      </label>

      <div class="settings-actions">
        <AppButton variant="secondary" @click="$emit('close')">Cancel</AppButton>
        <AppButton @click="saveSettings">Save</AppButton>
      </div>
    </section>
  </div>
</template>
