export type ThemeMode = 'system' | 'light' | 'dark'
export type DensityMode = 'comfortable' | 'compact'

export interface AppSettings {
  autoRefreshIntervalMs: number
  densityMode: DensityMode
  editorCommand: string
  themeMode: ThemeMode
}

export const AUTO_REFRESH_INTERVAL_OPTIONS = [
  { label: '30 seconds', value: 30 * 1000 },
  { label: '1 minute', value: 60 * 1000 },
  { label: '5 minutes', value: 5 * 60 * 1000 },
] as const

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoRefreshIntervalMs: 60 * 1000,
  densityMode: 'comfortable',
  editorCommand: 'code',
  themeMode: 'system',
}
