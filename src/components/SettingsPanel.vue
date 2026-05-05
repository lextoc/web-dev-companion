<script setup lang="ts">
import { reactive, watch } from 'vue'
import {
  AUTO_REFRESH_INTERVAL_OPTIONS,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type ThemeMode,
} from '../settings'

const props = defineProps<{
  settings: AppSettings
}>()

const emit = defineEmits<{
  close: []
  save: [settings: AppSettings]
}>()

const draft = reactive<AppSettings>({ ...props.settings })

watch(
  () => props.settings,
  (settings) => {
    Object.assign(draft, settings)
  },
)

function saveSettings() {
  emit('save', {
    autoRefreshIntervalMs: Number(draft.autoRefreshIntervalMs) || DEFAULT_APP_SETTINGS.autoRefreshIntervalMs,
    editorCommand: draft.editorCommand.trim() || DEFAULT_APP_SETTINGS.editorCommand,
    themeMode: draft.themeMode,
  })
}

const themeOptions: Array<{ label: string; value: ThemeMode }> = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]
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
        <select v-model.number="draft.autoRefreshIntervalMs">
          <option
            v-for="option in AUTO_REFRESH_INTERVAL_OPTIONS"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </label>

      <label>
        <span>Theme</span>
        <select v-model="draft.themeMode">
          <option v-for="option in themeOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
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
