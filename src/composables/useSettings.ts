import { ref } from 'vue'
import { DEFAULT_APP_SETTINGS, normalizeAppSettings, type AppSettings } from '../settings'

function applyThemeMode(themeMode: AppSettings['themeMode']) {
  if (themeMode === 'system') {
    document.documentElement.removeAttribute('data-theme')
    return
  }

  document.documentElement.dataset.theme = themeMode
}

export function useSettings() {
  const appSettings = ref<AppSettings>({ ...DEFAULT_APP_SETTINGS })
  const isSettingsOpen = ref(false)

  function applySettings(settings: AppSettings) {
    applyThemeMode(settings.themeMode)
    document.documentElement.removeAttribute('data-density')
  }

  async function loadAppSettings() {
    try {
      const persistedState = await window.appState.read()
      appSettings.value = normalizeAppSettings(persistedState.settings)
    } catch {
      appSettings.value = { ...DEFAULT_APP_SETTINGS }
    }

    applySettings(appSettings.value)
  }

  async function saveAppSettings(settings: AppSettings) {
    appSettings.value = await window.appState.saveSettings(normalizeAppSettings(settings))
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
