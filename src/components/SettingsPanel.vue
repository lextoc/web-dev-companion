<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import {
  AUTO_REFRESH_INTERVAL_OPTIONS,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type ThemeMode,
} from '../settings'
import AppDropdown from './AppDropdown.vue'

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

      <label class="settings-toggle-row">
        <input v-model="draft.commitCelebrations" type="checkbox" />
        <span>
          <strong>Commit celebrations</strong>
          <small>Rainbow commit and sync buttons, plus confetti on successful submit.</small>
        </span>
      </label>

      <label>
        <span>Editor command</span>
        <input v-model="draft.editorCommand" type="text" autocomplete="off" placeholder="code" />
      </label>

      <div class="settings-actions">
        <button type="button" class="secondary" @click="$emit('close')">Cancel</button>
        <button type="button" @click="saveSettings">Save</button>
      </div>
    </section>
  </div>
</template>
