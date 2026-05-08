import path from 'node:path'
import type { BrowserWindow as BrowserWindowType, OpenDialogOptions } from 'electron'
import type {
  CheckoutBranchRequest,
  CheckoutRemoteBranchRequest,
  CheckoutSubmoduleBranchRequest,
  CommitDetailsRequest,
  CommitRequest,
  DeleteBranchRequest,
  DeleteSubmoduleBranchRequest,
  DesktopMenuCommand,
  DesktopMenuState,
  DesktopNotificationRequest,
  MergeBranchRequest,
  MergeLinkedSubmoduleBranchRequest,
  OpenCommitInBrowserRequest,
  RepositoryActionRequest,
  ResetTrackedChangesRequest,
  ScriptOutput,
  GitCommandLogEntry,
  ScriptRunRequest,
  StatusFileDiffRequest,
  StatusFileRequest,
  SyncBranchRequest,
  SyncSubmoduleBranchRequest,
} from '../src/repositories'
import { createAppStateService } from './app-state-service'
import { createRepositoryService } from './repository-service'
import { createScriptRunner } from './script-runner'
import { onGitCommandLog } from './git'

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
} = require('electron') as typeof import('electron')
const currentDirectory = __dirname
const appName = 'Web Dev Companion'
const appStateFileName = 'app-state.json'
const repositoriesFileName = 'repositories.json'
const refreshCommandThrottleMs = 1000
const windowBounds = {
  width: 1360,
  height: 820,
  minWidth: 1360,
  minHeight: 820,
}

app.setName(appName)

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
//
process.env.APP_ROOT = path.join(currentDirectory, '..')

// Use ['ENV_NAME'] to avoid Vite define plugin replacement.
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindowType | null
let lastRefreshCommandAt = 0
let isFlushingAppStateBeforeQuit = false
let isExitingAfterSignal = false
const desktopMenuState: DesktopMenuState = {
  hasRepositoryDetail: false,
  hasRunningScripts: false,
}

const repositoryDetailMenuItemIds = [
  'menu-dashboard',
  'menu-open-in-editor',
  'menu-open-in-file-manager',
  'menu-open-in-terminal',
]

function appStateFilePath() {
  return path.join(app.getPath('userData'), appStateFileName)
}

function repositoriesFilePath() {
  return path.join(app.getPath('userData'), repositoriesFileName)
}

function appIconPath() {
  return path.join(process.env.VITE_PUBLIC, 'web-dev-companion.png')
}

function configureAppIdentity() {
  if (process.platform === 'darwin') {
    const appIcon = nativeImage.createFromPath(appIconPath())

    if (!appIcon.isEmpty()) {
      app.dock.setIcon(appIcon)
      app.setAboutPanelOptions({
        applicationName: appName,
        iconPath: appIconPath(),
      })
    }
  }
}

function sendScriptOutput(output: ScriptOutput) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return
  }

  try {
    win.webContents.send('repositories:script-output', output)
  } catch {
    // Renderer reloads can dispose the frame while script output is still arriving.
  }
}

function sendGitCommandLog(entry: GitCommandLogEntry) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return
  }

  try {
    win.webContents.send('repositories:git-command', entry)
  } catch {
    // Renderer reloads can dispose the frame while git commands are still completing.
  }
}

function sendMenuCommand(command: DesktopMenuCommand) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return
  }

  win.webContents.send('desktop:menu-command', command)
}

function sendThrottledRefreshCommand() {
  const now = Date.now()

  if (now - lastRefreshCommandAt < refreshCommandThrottleMs) {
    return
  }

  lastRefreshCommandAt = now
  sendMenuCommand('refresh')
}

function isRepositoryRefreshShortcut(input: Electron.Input) {
  return (
    input.type === 'keyDown' &&
    input.key.toLowerCase() === 'r' &&
    (input.meta || input.control) &&
    !input.alt &&
    !input.shift
  )
}

function isZoomShortcut(input: Electron.Input) {
  if (input.type !== 'keyDown' || (!input.meta && !input.control) || input.alt) {
    return false
  }

  return ['+', '=', '-', '_', '0'].includes(input.key)
}

function setMenuItemEnabled(id: string, enabled: boolean) {
  const item = Menu.getApplicationMenu()?.getMenuItemById(id)

  if (item) {
    item.enabled = enabled
  }
}

function updateApplicationMenuState() {
  for (const itemId of repositoryDetailMenuItemIds) {
    setMenuItemEnabled(itemId, desktopMenuState.hasRepositoryDetail)
  }

  setMenuItemEnabled('menu-stop-scripts', desktopMenuState.hasRunningScripts)
}

function updateDesktopMenuState(state: DesktopMenuState) {
  desktopMenuState.hasRepositoryDetail = state.hasRepositoryDetail
  desktopMenuState.hasRunningScripts = state.hasRunningScripts
  updateApplicationMenuState()

  return { ...desktopMenuState }
}

function configureApplicationMenu() {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: appName,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Settings...',
                accelerator: 'Command+,',
                click: () => sendMenuCommand('settings'),
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Repository...',
          accelerator: isMac ? 'Command+O' : 'Ctrl+O',
          click: () => sendMenuCommand('add-repository'),
        },
        {
          id: 'menu-dashboard',
          label: 'Dashboard',
          accelerator: isMac ? 'Command+1' : 'Ctrl+1',
          enabled: desktopMenuState.hasRepositoryDetail,
          click: () => sendMenuCommand('dashboard'),
        },
        ...(isMac
          ? []
          : [
              { type: 'separator' as const },
              {
                label: 'Settings...',
                accelerator: 'Ctrl+,',
                click: () => sendMenuCommand('settings'),
              },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Repository',
      submenu: [
        {
          label: 'Refresh',
          accelerator: isMac ? 'Command+R' : 'Ctrl+R',
          click: () => sendThrottledRefreshCommand(),
        },
        { type: 'separator' },
        {
          id: 'menu-open-in-editor',
          label: 'Open in Editor',
          accelerator: isMac ? 'Command+E' : 'Ctrl+E',
          enabled: desktopMenuState.hasRepositoryDetail,
          click: () => sendMenuCommand('open-in-editor'),
        },
        {
          id: 'menu-open-in-file-manager',
          label: 'Open in Files',
          accelerator: isMac ? 'Command+Shift+F' : 'Ctrl+Shift+F',
          enabled: desktopMenuState.hasRepositoryDetail,
          click: () => sendMenuCommand('open-in-file-manager'),
        },
        {
          id: 'menu-open-in-terminal',
          label: 'Open in Terminal',
          accelerator: isMac ? 'Command+`' : 'Ctrl+`',
          enabled: desktopMenuState.hasRepositoryDetail,
          click: () => sendMenuCommand('open-in-terminal'),
        },
      ],
    },
    {
      label: 'Scripts',
      submenu: [
        {
          id: 'menu-stop-scripts',
          label: 'Stop Running Scripts',
          accelerator: isMac ? 'Command+Shift+S' : 'Ctrl+Shift+S',
          enabled: desktopMenuState.hasRunningScripts,
          click: () => sendMenuCommand('stop-scripts'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: isMac ? 'Command+/' : 'Ctrl+/',
          click: () => sendMenuCommand('keyboard-shortcuts'),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  updateApplicationMenuState()
}

const repositoryService = createRepositoryService(repositoriesFilePath, shell)
const appStateService = createAppStateService(appStateFilePath)
const scriptRunner = createScriptRunner({ sendOutput: sendScriptOutput })
onGitCommandLog(sendGitCommandLog)

function registerAppStateHandlers() {
  ipcMain.handle('app-state:read', appStateService.read)
  ipcMain.handle('app-state:save-settings', (_event, settings) => appStateService.saveSettings(settings))
  ipcMain.handle('app-state:save-pinned-repository-paths', (_event, repoPaths) =>
    appStateService.savePinnedRepositoryPaths(repoPaths),
  )
  ipcMain.handle('app-state:save-pinned-scripts', (_event, scripts) => appStateService.savePinnedScripts(scripts))
  ipcMain.handle('app-state:save-recent-command-ids', (_event, commandIds) =>
    appStateService.saveRecentCommandIds(commandIds),
  )
  ipcMain.handle('app-state:save-repository-branch-links', (_event, links) =>
    appStateService.saveRepositoryBranchLinks(links),
  )
}

function registerRepositoryHandlers() {
  ipcMain.handle('repositories:list', repositoryService.listRepositories)
  ipcMain.handle('repositories:add-by-path', (_event, repoPath: string) => repositoryService.addRepository(repoPath))
  ipcMain.handle('repositories:remove', (_event, repoPath: string) => repositoryService.removeRepository(repoPath))
  ipcMain.handle('repositories:details', (_event, repoPath: string) => repositoryService.readRepositoryDetails(repoPath))
  ipcMain.handle('repositories:checkout-branch', (_event, request: CheckoutBranchRequest) =>
    repositoryService.checkoutBranch(request),
  )
  ipcMain.handle('repositories:checkout-remote-branch', (_event, request: CheckoutRemoteBranchRequest) =>
    repositoryService.checkoutRemoteBranch(request),
  )
  ipcMain.handle('repositories:checkout-submodule-branch', (_event, request: CheckoutSubmoduleBranchRequest) =>
    repositoryService.checkoutSubmoduleBranch(request),
  )
  ipcMain.handle('repositories:delete-branch', (_event, request: DeleteBranchRequest) =>
    repositoryService.deleteBranch(request),
  )
  ipcMain.handle('repositories:delete-submodule-branch', (_event, request: DeleteSubmoduleBranchRequest) =>
    repositoryService.deleteSubmoduleBranch(request),
  )
  ipcMain.handle('repositories:merge-branch', (_event, request: MergeBranchRequest) =>
    repositoryService.mergeBranch(request),
  )
  ipcMain.handle('repositories:merge-linked-submodule-branch', (_event, request: MergeLinkedSubmoduleBranchRequest) =>
    repositoryService.mergeLinkedSubmoduleBranch(request),
  )
  ipcMain.handle('repositories:sync-branch', (_event, request: SyncBranchRequest) =>
    repositoryService.syncBranch(request),
  )
  ipcMain.handle('repositories:sync-submodule-branch', (_event, request: SyncSubmoduleBranchRequest) =>
    repositoryService.syncSubmoduleBranch(request),
  )
  ipcMain.handle('repositories:stage-files', (_event, request: StatusFileRequest) =>
    repositoryService.stageFiles(request),
  )
  ipcMain.handle('repositories:unstage-files', (_event, request: StatusFileRequest) =>
    repositoryService.unstageFiles(request),
  )
  ipcMain.handle('repositories:reset-tracked-changes', (_event, request: ResetTrackedChangesRequest) =>
    repositoryService.resetTrackedChanges(request),
  )
  ipcMain.handle('repositories:diff-file', (_event, request: StatusFileDiffRequest) =>
    repositoryService.diffFile(request),
  )
  ipcMain.handle('repositories:commit-details', (_event, request: CommitDetailsRequest) =>
    repositoryService.readCommitDetails(request),
  )
  ipcMain.handle('repositories:commit', (_event, request: CommitRequest) => repositoryService.commit(request))
  ipcMain.handle('repositories:open-commit-in-browser', (_event, request: OpenCommitInBrowserRequest) =>
    repositoryService.openCommitInBrowser(request),
  )
  ipcMain.handle('repositories:open-in-file-manager', (_event, request: RepositoryActionRequest) =>
    repositoryService.openInFileManager(request),
  )
  ipcMain.handle('repositories:open-in-editor', (_event, request: RepositoryActionRequest) =>
    repositoryService.openInEditor(request),
  )
  ipcMain.handle('repositories:open-in-terminal', (_event, request: RepositoryActionRequest) =>
    repositoryService.openInTerminal(request),
  )
  ipcMain.handle('repositories:health', (_event, repoPath: string) => repositoryService.health(repoPath))
  ipcMain.handle('repositories:check-outdated-dependencies', (_event, repoPath: string) =>
    repositoryService.checkOutdatedDependencies(repoPath),
  )
  ipcMain.handle('repositories:start-script', (_event, request: ScriptRunRequest) => scriptRunner.startScript(request))
  ipcMain.handle('repositories:stop-script', (_event, runId: string) => scriptRunner.stopScript(runId))
  ipcMain.handle('repositories:choose-and-add', chooseAndAddRepository)
  ipcMain.handle('desktop:set-menu-state', (_event, state: DesktopMenuState) => updateDesktopMenuState(state))
  ipcMain.handle('desktop:notify', (_event, request: DesktopNotificationRequest) => {
    if (!Notification.isSupported()) {
      return false
    }

    new Notification({
      title: request.title,
      body: request.body,
      icon: appIconPath(),
    }).show()

    return true
  })
  ipcMain.on('repositories:stop-scripts', (_event, runIds: string[]) => {
    for (const runId of runIds) {
      scriptRunner.stopScript(runId)
    }
  })
}

async function chooseAndAddRepository() {
  const dialogOptions: OpenDialogOptions = {
    properties: ['openDirectory'],
    title: 'Add repository',
  }
  const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled || !result.filePaths[0]) {
    return repositoryService.listRepositories()
  }

  return repositoryService.addRepository(result.filePaths[0])
}

function createWindow() {
  win = new BrowserWindow({
    ...windowBounds,
    title: appName,
    icon: appIconPath(),
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 18, y: 10 },
          vibrancy: 'sidebar' as const,
          visualEffectState: 'active' as const,
        }
      : {}),
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.js'),
    },
  })

  win.webContents.setZoomFactor(1)
  win.webContents.setVisualZoomLevelLimits(1, 1)

  win.on('focus', () => {
    win?.webContents.send('repositories:window-focus')
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (isZoomShortcut(input)) {
      event.preventDefault()
      win?.webContents.setZoomFactor(1)
      return
    }

    if (!isRepositoryRefreshShortcut(input)) {
      return
    }

    event.preventDefault()
    sendThrottledRefreshCommand()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  scriptRunner.stopAllScripts()

  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('before-quit', (event) => {
  if (isFlushingAppStateBeforeQuit) {
    return
  }

  event.preventDefault()
  isFlushingAppStateBeforeQuit = true

  void appStateService.flush()
    .catch((error) => {
      console.error('Could not flush app state before quit.', error)
    })
    .finally(() => {
      app.quit()
    })
})

function flushAppStateAndExitAfterSignal(signal: NodeJS.Signals) {
  if (isExitingAfterSignal) {
    return
  }

  isExitingAfterSignal = true
  isFlushingAppStateBeforeQuit = true
  scriptRunner.stopAllScripts()

  void appStateService.flush()
    .catch((error) => {
      console.error(`Could not flush app state after ${signal}.`, error)
    })
    .finally(() => {
      app.exit(0)
    })
}

process.once('SIGINT', flushAppStateAndExitAfterSignal)
process.once('SIGTERM', flushAppStateAndExitAfterSignal)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  configureAppIdentity()
  configureApplicationMenu()
  registerAppStateHandlers()
  registerRepositoryHandlers()
  createWindow()
})
