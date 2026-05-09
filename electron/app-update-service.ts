import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { AppUpdateRelease, AppUpdateState, AppUpdateStatus } from '../src/updates'

interface AppUpdateServiceOptions {
  app: Electron.App
  isDevelopment: boolean
  onBeforeInstall: () => Promise<void>
  sendState: (state: AppUpdateState) => void
}

export function createAppUpdateService({
  app,
  isDevelopment,
  onBeforeInstall,
  sendState,
}: AppUpdateServiceOptions) {
  const canUpdate = !isDevelopment && ['darwin', 'win32'].includes(process.platform)
  let isChecking = false
  let isDownloading = false
  let state: AppUpdateState = createState(canUpdate ? 'idle' : 'unsupported')

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = app.getVersion().includes('-')
  autoUpdater.logger = null

  function createState(status: AppUpdateStatus, patch: Partial<AppUpdateState> = {}): AppUpdateState {
    const nextState: AppUpdateState = {
      status,
      currentVersion: app.getVersion(),
      canCheck: canUpdate && !isChecking && !isDownloading,
      canDownload: canUpdate && status === 'available' && !isDownloading,
      canInstall: canUpdate && status === 'downloaded',
      ...patch,
    }

    if (nextState.status !== 'downloading') {
      delete nextState.downloadPercent
    }

    if (nextState.status !== 'error') {
      delete nextState.error
    }

    return nextState
  }

  function publishState(status: AppUpdateStatus, patch: Partial<AppUpdateState> = {}) {
    state = createState(status, patch)
    sendState(state)

    return state
  }

  function releaseFromUpdateInfo(info: UpdateInfo): AppUpdateRelease {
    return {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseName: info.releaseName ?? undefined,
    }
  }

  function updateError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    publishState('error', {
      error: message,
      update: state.update,
    })
  }

  autoUpdater.on('checking-for-update', () => {
    publishState('checking', { update: state.update })
  })

  autoUpdater.on('update-available', (info) => {
    isChecking = false
    publishState('available', { update: releaseFromUpdateInfo(info) })
  })

  autoUpdater.on('update-not-available', () => {
    isChecking = false
    publishState('not-available')
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    publishState('downloading', {
      downloadPercent: progress.percent,
      update: state.update,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    isDownloading = false
    publishState('downloaded', { update: releaseFromUpdateInfo(info) })
  })

  autoUpdater.on('error', (error) => {
    isChecking = false
    isDownloading = false
    updateError(error)
  })

  async function checkForUpdates() {
    if (!canUpdate || isChecking || isDownloading || state.status === 'downloaded') {
      return state
    }

    isChecking = true
    publishState('checking', { update: state.update })

    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      isChecking = false
      updateError(error)
    }

    return state
  }

  async function downloadUpdate() {
    if (!canUpdate || isDownloading || state.status !== 'available') {
      return state
    }

    isDownloading = true
    publishState('downloading', {
      downloadPercent: 0,
      update: state.update,
    })

    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      isDownloading = false
      updateError(error)
    }

    return state
  }

  async function installUpdate() {
    if (!canUpdate || state.status !== 'downloaded') {
      return state
    }

    await onBeforeInstall()
    autoUpdater.quitAndInstall(false, true)

    return state
  }

  return {
    getState: () => state,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  }
}
