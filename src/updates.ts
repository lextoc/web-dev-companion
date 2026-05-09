export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported'

export interface AppUpdateRelease {
  version: string
  releaseDate?: string
  releaseName?: string
}

export interface AppUpdateState {
  status: AppUpdateStatus
  currentVersion: string
  canCheck: boolean
  canDownload: boolean
  canInstall: boolean
  update?: AppUpdateRelease
  downloadPercent?: number
  error?: string
}

export interface AppUpdatesApi {
  getState: () => Promise<AppUpdateState>
  check: () => Promise<AppUpdateState>
  download: () => Promise<AppUpdateState>
  install: () => Promise<AppUpdateState>
  onStateChange: (listener: (state: AppUpdateState) => void) => () => void
}
