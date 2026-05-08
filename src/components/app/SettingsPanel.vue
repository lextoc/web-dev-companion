<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import {
  AUTO_REFRESH_INTERVAL_OPTIONS,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type ThemeMode,
} from '../../settings'
import { AppButton, AppCheckbox, AppDropdown } from '../ui'

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
        class="commit-celebrations-setting"
        description="Rainbow commit and sync buttons, current branch chip, plus confetti on successful submit."
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

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(4, 8, 12, 0.62);
}

.settings-dialog {
  display: grid;
  width: min(520px, 100%);
  gap: 16px;
  border: 0;
  border-radius: 8px;
  padding: 18px;
  background: var(--surface);
  color: var(--text);
  box-shadow: none;
}

.settings-dialog h2 {
  margin: 0;
  font-size: var(--font-size-title);
}

.settings-dialog label {
  display: grid;
  gap: 6px;
}

.settings-dialog :deep(.app-checkbox) {
  position: relative;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  border: 0;
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--surface-soft);
}

.settings-dialog :deep(.commit-celebrations-setting) {
  isolation: isolate;
  overflow: hidden;
  background: transparent;
}

.settings-dialog :deep(.commit-celebrations-setting)::before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: 0;
  background: linear-gradient(
    90deg,
    #ff4f8b 0%,
    #ff4f8b 10%,
    #ff8f3d 18%,
    #ffdd4d 28%,
    #59d66f 40%,
    #43d9ff 54%,
    #8b67ff 68%,
    #d85dff 80%,
    #ff4f8b 92%,
    #ff4f8b 100%
  );
  background-position: 0% 50%;
  background-size: 520% 100%;
  opacity: 0.18;
  animation: rainbow-button-flow 8s linear infinite;
}

.settings-dialog :deep(.commit-celebrations-setting)::after {
  content: "";
  position: absolute;
  z-index: -1;
  inset: 1px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--surface-soft) 78%, transparent);
}

.settings-dialog label span {
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.settings-dialog :deep(.app-checkbox span) {
  display: grid;
  gap: 2px;
  text-transform: none;
}

.settings-dialog :deep(.app-checkbox strong) {
  color: var(--text);
  font-size: var(--font-size-base);
}

.settings-dialog :deep(.app-checkbox small) {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 700;
}

.settings-dialog input {
  width: 100%;
  min-height: 42px;
  border: 1px solid var(--border-control);
  border-radius: 7px;
  padding: 0 12px;
  background: var(--surface);
  color: var(--text);
}

.settings-dialog input[type="checkbox"] {
  width: 18px;
  min-height: 18px;
  accent-color: var(--brand);
}

.settings-dialog :deep(.app-dropdown) {
  width: 100%;
}

.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}

</style>
