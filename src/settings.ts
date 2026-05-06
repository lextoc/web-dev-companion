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
