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
  TerminalWindowActionRequest,
  TerminalWindowControlAction,
  TerminalWindowReassignment,
  MergeBranchRequest,
  MergeLinkedSubmoduleBranchRequest,
  OpenCommitInBrowserRequest,
  RepositoryActionRequest,
  ScriptTerminal,
  ResetTrackedChangesRequest,
  ScriptOutput,
  GitCommandLogEntry,
  ScriptRunRequest,
  StatusFileDiffRequest,
  StatusFileRequest,
  SyncBranchRequest,
  SyncSubmoduleBranchRequest,
} from '../src/repositories'
import type { AppUpdateState } from '../src/updates'
import { createAppStateService } from './app-state-service'
import { createAppUpdateService } from './app-update-service'
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
  screen,
  shell,
} = require('electron') as typeof import('electron')
const currentDirectory = __dirname
const appName = 'Web Dev Companion'
const appStateFileName = 'app-state.json'
const repositoriesFileName = 'repositories.json'
const refreshCommandThrottleMs = 1000
const devParentPollMs = 1000
const windowBounds = {
  width: 1360,
  height: 820,
  minWidth: 1360,
  minHeight: 820,
}
const terminalWindowBounds = {
  width: 720,
  height: 560,
  minWidth: 520,
  minHeight: 360,
}
const terminalWindowGutter = 16

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
let devParentWatcher: NodeJS.Timeout | undefined
const terminalWindowsByRunId = new Map<string, Set<BrowserWindowType>>()
const terminalRunIdByWindowId = new Map<number, string>()
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

function platformWindowOptions(): Electron.BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 18, y: 10 },
      vibrancy: 'sidebar' as const,
      visualEffectState: 'active' as const,
    }
  }

  if (process.platform === 'win32') {
    return {
      autoHideMenuBar: true,
      titleBarOverlay: {
        color: '#f8fafc',
        height: 36,
        symbolColor: '#1f2937',
      },
      titleBarStyle: 'hidden' as const,
    }
  }

  return {}
}

function terminalPlatformWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return {
    autoHideMenuBar: true,
    backgroundColor: '#0c1116',
    frame: false,
    hasShadow: true,
    titleBarStyle: 'default' as const,
  }
}

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
    const aboutPanelOptions: Electron.AboutPanelOptionsOptions = {
      applicationName: appName,
    }

    if (!appIcon.isEmpty()) {
      app.dock.setIcon(appIcon)
      aboutPanelOptions.iconPath = appIconPath()
    }

    app.setAboutPanelOptions(aboutPanelOptions)
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

function sendAppUpdateState(state: AppUpdateState) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return
  }

  win.webContents.send('updates:state-change', state)
}

function terminalWindowTitle(terminal: Pick<ScriptTerminal, 'repoName' | 'taskName'>) {
  return `${terminal.taskName} - ${terminal.repoName}`
}

function activeTerminalWindowCount() {
  return [...terminalWindowsByRunId.values()].reduce((count, terminalWindows) => (
    count + [...terminalWindows].filter((terminalWindow) => !terminalWindow.isDestroyed()).length
  ), 0)
}

function terminalWindowWorkArea() {
  if (!win || win.isDestroyed()) {
    return screen.getPrimaryDisplay().workArea
  }

  const mainWindowBounds = win.getBounds()
  const mainWindowCenter = {
    x: mainWindowBounds.x + Math.round(mainWindowBounds.width / 2),
    y: mainWindowBounds.y + Math.round(mainWindowBounds.height / 2),
  }

  return screen.getDisplayNearestPoint(mainWindowCenter).workArea
}

function terminalWindowPosition(): Pick<Electron.BrowserWindowConstructorOptions, 'x' | 'y'> {
  const workArea = terminalWindowWorkArea()
  const openWindowCount = activeTerminalWindowCount()
  const columns = Math.max(
    1,
    Math.floor((workArea.width + terminalWindowGutter) / (terminalWindowBounds.width + terminalWindowGutter)),
  )
  const rows = Math.max(
    1,
    Math.floor((workArea.height + terminalWindowGutter) / (terminalWindowBounds.height + terminalWindowGutter)),
  )
  const slotIndex = openWindowCount % Math.max(1, columns * rows)
  const columnIndex = slotIndex % columns
  const rowIndex = Math.floor(slotIndex / columns)
  const maxXOffset = Math.max(0, workArea.width - terminalWindowBounds.width)
  const maxYOffset = Math.max(0, workArea.height - terminalWindowBounds.height)

  return {
    x: workArea.x + Math.min(maxXOffset, columnIndex * (terminalWindowBounds.width + terminalWindowGutter)),
    y: workArea.y + Math.min(maxYOffset, rowIndex * (terminalWindowBounds.height + terminalWindowGutter)),
  }
}

function sendTerminalWindowState(
  terminalWindow: BrowserWindowType,
  runId: string,
  terminal: ScriptTerminal | null,
) {
  if (terminalWindow.isDestroyed() || terminalWindow.webContents.isDestroyed()) {
    return
  }

  terminalWindow.webContents.send('desktop:terminal-window-state', {
    runId,
    terminal,
  })
}

function terminalWindowSetForRun(runId: string) {
  const existingWindows = terminalWindowsByRunId.get(runId)

  if (existingWindows) {
    return existingWindows
  }

  const terminalWindows = new Set<BrowserWindowType>()
  terminalWindowsByRunId.set(runId, terminalWindows)
  return terminalWindows
}

function removeTerminalWindow(terminalWindow: BrowserWindowType) {
  const runId = terminalRunIdByWindowId.get(terminalWindow.id)

  if (!runId) {
    return
  }

  terminalRunIdByWindowId.delete(terminalWindow.id)
  const terminalWindows = terminalWindowsByRunId.get(runId)
  terminalWindows?.delete(terminalWindow)

  if (terminalWindows?.size === 0) {
    terminalWindowsByRunId.delete(runId)
  }
}

function registerTerminalWindow(runId: string, terminalWindow: BrowserWindowType) {
  terminalRunIdByWindowId.set(terminalWindow.id, runId)
  terminalWindowSetForRun(runId).add(terminalWindow)

  terminalWindow.on('closed', () => {
    removeTerminalWindow(terminalWindow)
  })
}

function loadRendererWindow(targetWindow: BrowserWindowType, query?: Record<string, string>) {
  if (VITE_DEV_SERVER_URL) {
    const rendererUrl = new URL(VITE_DEV_SERVER_URL)

    for (const [key, value] of Object.entries(query ?? {})) {
      rendererUrl.searchParams.set(key, value)
    }

    targetWindow.loadURL(rendererUrl.toString())
    return
  }

  targetWindow.loadFile(path.join(RENDERER_DIST, 'index.html'), query ? { query } : undefined)
}

function createTerminalWindow(terminal: ScriptTerminal) {
  const terminalWindow = new BrowserWindow({
    ...terminalWindowBounds,
    ...terminalWindowPosition(),
    title: terminalWindowTitle(terminal),
    icon: appIconPath(),
    ...terminalPlatformWindowOptions(),
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.js'),
    },
  })

  if (process.platform === 'win32') {
    terminalWindow.setMenuBarVisibility(false)
  }

  terminalWindow.webContents.setZoomFactor(1)
  terminalWindow.webContents.setVisualZoomLevelLimits(1, 1)
  registerTerminalWindow(terminal.runId, terminalWindow)

  terminalWindow.webContents.on('before-input-event', (event, input) => {
    if (!isCloseWindowShortcut(input)) {
      return
    }

    event.preventDefault()
    terminalWindow.close()
  })

  terminalWindow.webContents.on('did-finish-load', () => {
    sendTerminalWindowState(terminalWindow, terminal.runId, terminal)
  })

  loadRendererWindow(terminalWindow, {
    terminalRunId: terminal.runId,
    window: 'terminal',
  })

  return true
}

function broadcastTerminalWindowState(terminal: ScriptTerminal) {
  const terminalWindows = terminalWindowsByRunId.get(terminal.runId)

  if (!terminalWindows) {
    return
  }

  for (const terminalWindow of terminalWindows) {
    terminalWindow.setTitle(terminalWindowTitle(terminal))
    sendTerminalWindowState(terminalWindow, terminal.runId, terminal)
  }
}

function closeTerminalWindows(runId: string) {
  const terminalWindows = terminalWindowsByRunId.get(runId)

  if (!terminalWindows) {
    return
  }

  for (const terminalWindow of [...terminalWindows]) {
    terminalWindow.close()
  }
}

function closeAllTerminalWindows() {
  for (const runId of [...terminalWindowsByRunId.keys()]) {
    closeTerminalWindows(runId)
  }
}

function reassignTerminalWindows({ previousRunId, terminal }: TerminalWindowReassignment) {
  const terminalWindows = terminalWindowsByRunId.get(previousRunId)

  if (!terminalWindows) {
    return
  }

  terminalWindowsByRunId.delete(previousRunId)
  const nextWindows = terminalWindowSetForRun(terminal.runId)

  for (const terminalWindow of terminalWindows) {
    terminalRunIdByWindowId.set(terminalWindow.id, terminal.runId)
    nextWindows.add(terminalWindow)
    terminalWindow.setTitle(terminalWindowTitle(terminal))
    sendTerminalWindowState(terminalWindow, terminal.runId, terminal)
  }
}

function controlTerminalWindow(
  sender: Electron.WebContents,
  action: TerminalWindowControlAction,
) {
  const terminalWindow = BrowserWindow.fromWebContents(sender)

  if (!terminalWindow || !terminalRunIdByWindowId.has(terminalWindow.id)) {
    return
  }

  if (action === 'close') {
    terminalWindow.close()
    return
  }

  if (action === 'minimize') {
    terminalWindow.minimize()
    return
  }

  if (terminalWindow.isMaximized()) {
    terminalWindow.unmaximize()
    return
  }

  terminalWindow.maximize()
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

function isCloseWindowShortcut(input: Electron.Input) {
  return (
    input.type === 'keyDown' &&
    input.key.toLowerCase() === 'w' &&
    !input.alt &&
    !input.shift &&
    ((input.meta && !input.control) || (input.control && !input.meta))
  )
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
                label: 'Check for Updates...',
                click: () => sendMenuCommand('check-for-updates'),
              },
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
        ...(isMac
          ? []
          : [
              {
                label: 'Check for Updates...',
                click: () => sendMenuCommand('check-for-updates'),
              },
              { type: 'separator' as const },
            ]),
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
const appUpdateService = createAppUpdateService({
  app,
  isDevelopment: Boolean(VITE_DEV_SERVER_URL),
  onBeforeInstall: async () => {
    isFlushingAppStateBeforeQuit = true
    scriptRunner.stopAllScripts()
    await appStateService.flush()
  },
  sendState: sendAppUpdateState,
})
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
  ipcMain.handle('repositories:list-github-repositories', repositoryService.listGitHubRepositories)
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
  ipcMain.handle('repositories:scan-local-repositories', chooseAndScanLocalRepositories)
  ipcMain.handle('repositories:clone-github-repository', (_event, nameWithOwner: string) =>
    chooseAndCloneGitHubRepository(nameWithOwner),
  )
  ipcMain.handle('desktop:set-menu-state', (_event, state: DesktopMenuState) => updateDesktopMenuState(state))
  ipcMain.handle('desktop:open-terminal-window', (_event, terminal: ScriptTerminal) => createTerminalWindow(terminal))
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
  ipcMain.on('desktop:update-terminal-window', (_event, terminal: ScriptTerminal) => {
    broadcastTerminalWindowState(terminal)
  })
  ipcMain.on('desktop:close-terminal-window', (_event, runId: string) => {
    closeTerminalWindows(runId)
  })
  ipcMain.on('desktop:reassign-terminal-window', (_event, reassignment: TerminalWindowReassignment) => {
    reassignTerminalWindows(reassignment)
  })
  ipcMain.on('desktop:request-terminal-window-state', (_event, runId: string) => {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      closeTerminalWindows(runId)
      return
    }

    win.webContents.send('desktop:terminal-window-state-request', runId)
  })
  ipcMain.on('desktop:terminal-window-control', (event, action: TerminalWindowControlAction) => {
    controlTerminalWindow(event.sender, action)
  })
  ipcMain.on('desktop:terminal-window-action', (_event, request: TerminalWindowActionRequest) => {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      closeTerminalWindows(request.runId)
      return
    }

    win.webContents.send('desktop:terminal-window-action', request)
  })
  ipcMain.handle('updates:get-state', () => appUpdateService.getState())
  ipcMain.handle('updates:check', () => appUpdateService.checkForUpdates())
  ipcMain.handle('updates:download', () => appUpdateService.downloadUpdate())
  ipcMain.handle('updates:install', () => appUpdateService.installUpdate())
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

async function chooseAndCloneGitHubRepository(nameWithOwner: string) {
  const dialogOptions: OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose clone destination',
  }
  const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled || !result.filePaths[0]) {
    return repositoryService.listRepositories()
  }

  return repositoryService.cloneGitHubRepository({
    nameWithOwner,
    parentDirectory: result.filePaths[0],
  })
}

async function chooseAndScanLocalRepositories() {
  const dialogOptions: OpenDialogOptions = {
    properties: ['openDirectory'],
    title: 'Scan for local repositories',
  }
  const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled || !result.filePaths[0]) {
    return []
  }

  return repositoryService.scanLocalRepositories(result.filePaths[0])
}

function createWindow() {
  win = new BrowserWindow({
    ...windowBounds,
    title: appName,
    icon: appIconPath(),
    ...platformWindowOptions(),
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.js'),
    },
  })

  if (process.platform === 'win32') {
    win.setMenuBarVisibility(false)
  }

  win.webContents.setZoomFactor(1)
  win.webContents.setVisualZoomLevelLimits(1, 1)

  win.on('focus', () => {
    win?.webContents.send('repositories:window-focus')
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  win.on('closed', () => {
    win = null
    closeAllTerminalWindows()
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

  loadRendererWindow(win)
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

function flushAppStateAndExit(reason: string) {
  if (isExitingAfterSignal) {
    return
  }

  isExitingAfterSignal = true
  isFlushingAppStateBeforeQuit = true
  scriptRunner.stopAllScripts()
  closeAllTerminalWindows()

  void appStateService.flush()
    .catch((error) => {
      console.error(`Could not flush app state before ${reason}.`, error)
    })
    .finally(() => {
      app.exit(0)
    })
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

function watchDevParentProcess() {
  if (!VITE_DEV_SERVER_URL || process.ppid <= 1) {
    return
  }

  const devParentPid = process.ppid
  devParentWatcher = setInterval(() => {
    if (process.ppid !== 1 && isProcessAlive(devParentPid)) {
      return
    }

    if (devParentWatcher) {
      clearInterval(devParentWatcher)
      devParentWatcher = undefined
    }

    flushAppStateAndExit('dev parent exit')
  }, devParentPollMs)
  devParentWatcher.unref()
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
  watchDevParentProcess()
  createWindow()
  setTimeout(() => {
    void appUpdateService.checkForUpdates()
  }, 5000)
})
