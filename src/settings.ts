export type ThemeMode = 'system' | 'light' | 'dark'

export interface AppSettings {
  autoRefreshIntervalMs: number
  commitCelebrations: boolean
  editorCommand: string
  skipBranchSyncConfirmation: boolean
  themeMode: ThemeMode
}

export const AUTO_REFRESH_INTERVAL_OPTIONS = [
  { label: '30 seconds', value: 30 * 1000 },
  { label: '1 minute', value: 60 * 1000 },
  { label: '5 minutes', value: 5 * 60 * 1000 },
] as const

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoRefreshIntervalMs: 60 * 1000,
  commitCelebrations: true,
  editorCommand: 'code',
  skipBranchSyncConfirmation: false,
  themeMode: 'system',
}

export function normalizeAppSettings(settings: Partial<AppSettings>): AppSettings {
  const autoRefreshIntervalMs = Number(settings.autoRefreshIntervalMs)

  return {
    autoRefreshIntervalMs: autoRefreshIntervalMs > 0
      ? autoRefreshIntervalMs
      : DEFAULT_APP_SETTINGS.autoRefreshIntervalMs,
    commitCelebrations: typeof settings.commitCelebrations === 'boolean'
      ? settings.commitCelebrations
      : DEFAULT_APP_SETTINGS.commitCelebrations,
    editorCommand: typeof settings.editorCommand === 'string'
      ? settings.editorCommand
      : DEFAULT_APP_SETTINGS.editorCommand,
    skipBranchSyncConfirmation: typeof settings.skipBranchSyncConfirmation === 'boolean'
      ? settings.skipBranchSyncConfirmation
      : DEFAULT_APP_SETTINGS.skipBranchSyncConfirmation,
    themeMode: settings.themeMode === 'light' || settings.themeMode === 'dark' || settings.themeMode === 'system'
      ? settings.themeMode
      : DEFAULT_APP_SETTINGS.themeMode,
  }
}
