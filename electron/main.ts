import path from 'node:path'
import type { BrowserWindow as BrowserWindowType, OpenDialogOptions } from 'electron'
import type {
  CommitRequest,
  DeleteBranchRequest,
  RepositoryActionRequest,
  ScriptOutput,
  ScriptRunRequest,
  StatusFileRequest,
  SyncBranchRequest,
} from '../src/repositories'
import { createRepositoryService } from './repository-service'
import { createScriptRunner } from './script-runner'

const { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } = require('electron') as typeof import('electron')
const currentDirectory = __dirname
const appName = 'Web Dev Companion'
const repositoriesFileName = 'repositories.json'

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

const repositoryService = createRepositoryService(repositoriesFilePath, shell)
const scriptRunner = createScriptRunner({ sendOutput: sendScriptOutput })

function registerRepositoryHandlers() {
  ipcMain.handle('repositories:list', repositoryService.listRepositories)
  ipcMain.handle('repositories:add-by-path', (_event, repoPath: string) => repositoryService.addRepository(repoPath))
  ipcMain.handle('repositories:remove', (_event, repoPath: string) => repositoryService.removeRepository(repoPath))
  ipcMain.handle('repositories:details', (_event, repoPath: string) => repositoryService.readRepositoryDetails(repoPath))
  ipcMain.handle('repositories:delete-branch', (_event, request: DeleteBranchRequest) =>
    repositoryService.deleteBranch(request),
  )
  ipcMain.handle('repositories:sync-branch', (_event, request: SyncBranchRequest) =>
    repositoryService.syncBranch(request),
  )
  ipcMain.handle('repositories:stage-files', (_event, request: StatusFileRequest) =>
    repositoryService.stageFiles(request),
  )
  ipcMain.handle('repositories:unstage-files', (_event, request: StatusFileRequest) =>
    repositoryService.unstageFiles(request),
  )
  ipcMain.handle('repositories:commit', (_event, request: CommitRequest) => repositoryService.commit(request))
  ipcMain.handle('repositories:open-in-file-manager', (_event, request: RepositoryActionRequest) =>
    repositoryService.openInFileManager(request),
  )
  ipcMain.handle('repositories:open-in-editor', (_event, request: RepositoryActionRequest) =>
    repositoryService.openInEditor(request),
  )
  ipcMain.handle('repositories:open-in-terminal', (_event, request: RepositoryActionRequest) =>
    repositoryService.openInTerminal(request),
  )
  ipcMain.handle('repositories:start-script', (_event, request: ScriptRunRequest) => scriptRunner.startScript(request))
  ipcMain.handle('repositories:stop-script', (_event, runId: string) => scriptRunner.stopScript(runId))
  ipcMain.handle('repositories:choose-and-add', chooseAndAddRepository)
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
    width: 1600,
    height: 1000,
    minWidth: 1180,
    minHeight: 720,
    title: appName,
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.js'),
    },
  })

  win.maximize()

  win.on('focus', () => {
    win?.webContents.send('repositories:window-focus')
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
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

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  configureAppIdentity()
  registerRepositoryHandlers()
  createWindow()
})
