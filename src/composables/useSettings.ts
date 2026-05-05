import { ref } from 'vue'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../settings'

const APP_SETTINGS_KEY = 'web-dev-companion:settings'

function applyThemeMode(themeMode: AppSettings['themeMode']) {
  if (themeMode === 'system') {
    document.documentElement.removeAttribute('data-theme')
    return
  }

  document.documentElement.dataset.theme = themeMode
}

function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  const autoRefreshIntervalMs = Number(settings.autoRefreshIntervalMs)

  return {
    autoRefreshIntervalMs: autoRefreshIntervalMs > 0
      ? autoRefreshIntervalMs
      : DEFAULT_APP_SETTINGS.autoRefreshIntervalMs,
    editorCommand: typeof settings.editorCommand === 'string'
      ? settings.editorCommand
      : DEFAULT_APP_SETTINGS.editorCommand,
    themeMode: settings.themeMode === 'light' || settings.themeMode === 'dark' || settings.themeMode === 'system'
      ? settings.themeMode
      : DEFAULT_APP_SETTINGS.themeMode,
  }
}

export function useSettings() {
  const appSettings = ref<AppSettings>({ ...DEFAULT_APP_SETTINGS })
  const isSettingsOpen = ref(false)

  function applySettings(settings: AppSettings) {
    applyThemeMode(settings.themeMode)
    document.documentElement.removeAttribute('data-density')
  }

  function loadAppSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) ?? '{}') as Partial<AppSettings>
      appSettings.value = normalizeSettings(parsed)
    } catch {
      appSettings.value = { ...DEFAULT_APP_SETTINGS }
    }

    applySettings(appSettings.value)
  }

  function saveAppSettings(settings: AppSettings) {
    appSettings.value = normalizeSettings(settings)
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(appSettings.value))
    applySettings(appSettings.value)
    isSettingsOpen.value = false
  }

  return {
    appSettings,
    isSettingsOpen,
    loadAppSettings,
    saveAppSettings,
  }
}
