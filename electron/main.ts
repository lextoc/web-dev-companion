import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { BrowserWindow as BrowserWindowType, OpenDialogOptions } from 'electron'
import type {
  GitLogEntry,
  GitStatusEntry,
  GitStatusSummary,
  RepositoryDetails,
  RepositorySummary,
  ScriptOutput,
  ScriptRunRequest,
} from '../src/repositories'

const { app, BrowserWindow, dialog, ipcMain } = require('electron') as typeof import('electron')
const currentDirectory = __dirname
const execFileAsync = promisify(execFile)
const repositoriesFileName = 'repositories.json'
const runningScripts = new Map<string, ChildProcessWithoutNullStreams>()
const pendingScriptRuns = new Set<string>()

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
// │
process.env.APP_ROOT = path.join(currentDirectory, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindowType | null

function repositoriesFilePath() {
  return path.join(app.getPath('userData'), repositoriesFileName)
}

async function readRepositoryPaths() {
  try {
    const content = await fs.readFile(repositoriesFilePath(), 'utf8')
    const parsed = JSON.parse(content)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((repoPath): repoPath is string => typeof repoPath === 'string')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

async function writeRepositoryPaths(repoPaths: string[]) {
  await fs.mkdir(path.dirname(repositoriesFilePath()), { recursive: true })
  await fs.writeFile(repositoriesFilePath(), JSON.stringify(repoPaths, null, 2))
}

async function normalizeRepositoryPath(repoPath: string) {
  if (!repoPath.trim()) {
    throw new Error('Enter a repository path.')
  }

  const resolvedPath = path.resolve(repoPath.trim())
  const stats = await fs.stat(resolvedPath)

  if (!stats.isDirectory()) {
    throw new Error('Repository path must be a folder.')
  }

  const topLevelPath = await runGit(resolvedPath, ['rev-parse', '--show-toplevel'])

  return path.resolve(topLevelPath || resolvedPath)
}

async function runGit(repoPath: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repoPath,
      encoding: 'utf8',
      timeout: 5000,
    })

    return stdout.trim()
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message)
    }

    throw error
  }
}

async function tryRunGit(repoPath: string, args: string[]) {
  try {
    return await runGit(repoPath, args)
  } catch {
    return ''
  }
}

async function readPackageScripts(repoPath: string) {
  try {
    const packageJson = await fs.readFile(path.join(repoPath, 'package.json'), 'utf8')
    const parsed = JSON.parse(packageJson)
    const scripts = parsed?.scripts

    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(scripts).filter((entry): entry is [string, string] => {
        const [scriptName, command] = entry
        return typeof scriptName === 'string' && typeof command === 'string'
      }),
    )
  } catch {
    return {}
  }
}

async function detectPackageManager(repoPath: string) {
  const lockFiles = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['bun.lockb', 'bun'],
  ] as const

  for (const [lockFile, packageManager] of lockFiles) {
    try {
      await fs.access(path.join(repoPath, lockFile))
      return packageManager
    } catch {
      continue
    }
  }

  return undefined
}

function commandForPackageManager(packageManager: string | undefined) {
  return packageManager || 'npm'
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

function terminateScriptProcess(child: ChildProcessWithoutNullStreams) {
  if (process.platform === 'win32') {
    child.kill('SIGTERM')
    return
  }

  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
      return
    } catch {
      child.kill('SIGTERM')
    }
  }
}

function launchScript(runId: string, repoPath: string, packageManager: string, scriptName: string) {
  if (!pendingScriptRuns.has(runId)) {
    return
  }

  pendingScriptRuns.delete(runId)

  const child = spawn(packageManager, ['run', scriptName], {
    cwd: repoPath,
    detached: process.platform !== 'win32',
    env: process.env,
    shell: true,
  })

  runningScripts.set(runId, child)

  child.stdout.on('data', (chunk: Buffer) => {
    sendScriptOutput({
      runId,
      stream: 'stdout',
      text: chunk.toString(),
    })
  })

  child.stderr.on('data', (chunk: Buffer) => {
    sendScriptOutput({
      runId,
      stream: 'stderr',
      text: chunk.toString(),
    })
  })

  child.on('error', (error) => {
    sendScriptOutput({
      runId,
      stream: 'system',
      text: `${error.message}\n`,
      done: true,
    })
    runningScripts.delete(runId)
  })

  child.on('close', (exitCode, signal) => {
    sendScriptOutput({
      runId,
      stream: 'system',
      text: `\nProcess ${signal ? `stopped with ${signal}` : `exited with code ${exitCode ?? 0}`}.\n`,
      exitCode,
      signal,
      done: true,
    })
    runningScripts.delete(runId)
  })
}

async function startScript(request: ScriptRunRequest) {
  const repoPath = await normalizeRepositoryPath(request.repoPath)
  const npmScripts = await readPackageScripts(repoPath)

  if (!npmScripts[request.scriptName]) {
    throw new Error(`Script "${request.scriptName}" was not found.`)
  }

  const packageManager = commandForPackageManager(request.packageManager || (await detectPackageManager(repoPath)))
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const command = `${packageManager} run ${request.scriptName}`

  pendingScriptRuns.add(runId)
  setTimeout(() => {
    launchScript(runId, repoPath, packageManager, request.scriptName)
  }, 0)

  return {
    runId,
    command,
  }
}

function stopScript(runId: string) {
  if (pendingScriptRuns.delete(runId)) {
    sendScriptOutput({
      runId,
      stream: 'system',
      text: '\nProcess stopped before it started.\n',
      done: true,
    })

    return true
  }

  const child = runningScripts.get(runId)

  if (!child) {
    return false
  }

  terminateScriptProcess(child)

  return true
}

function stopAllScripts() {
  for (const runId of pendingScriptRuns) {
    stopScript(runId)
  }

  for (const child of runningScripts.values()) {
    terminateScriptProcess(child)
  }

  runningScripts.clear()
}

async function readRepositorySummary(repoPath: string): Promise<RepositorySummary> {
  const name = path.basename(repoPath)

  try {
    const [branch, lastCommit, status, remote, npmScripts] = await Promise.all([
      tryRunGit(repoPath, ['branch', '--show-current']),
      tryRunGit(repoPath, ['log', '-1', '--pretty=format:%h %s (%cr)']),
      tryRunGit(repoPath, ['status', '--short']),
      tryRunGit(repoPath, ['remote', 'get-url', 'origin']),
      readPackageScripts(repoPath),
    ])

    return {
      path: repoPath,
      name,
      branch: branch || 'detached',
      lastCommit: lastCommit || 'No commits found',
      dirty: status.length > 0,
      npmScriptCount: Object.keys(npmScripts).length,
      remote: remote || undefined,
    }
  } catch (error) {
    return {
      path: repoPath,
      name,
      branch: 'unknown',
      lastCommit: 'Unavailable',
      dirty: false,
      npmScriptCount: 0,
      error: error instanceof Error ? error.message : 'Could not read repository.',
    }
  }
}

async function readGitLogEntries(repoPath: string): Promise<GitLogEntry[]> {
  const fieldSeparator = '\x1f'
  const recordSeparator = '\x1e'
  const output = await tryRunGit(repoPath, [
    'log',
    '-n',
    '30',
    `--pretty=format:%h%x1f%cr%x1f%cI%x1f%an%x1f%ae%x1f%s%x1e`,
  ])

  if (!output) {
    return []
  }

  return output
    .split(recordSeparator)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', time = '', dateTime = '', authorName = '', authorEmail = '', message = ''] =
        record.split(fieldSeparator)

      return {
        hash,
        time,
        dateTime,
        authorName,
        authorEmail,
        message,
      }
    })
}

const statusLabels: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Unmerged',
  '?': 'Untracked',
}

function statusLabel(statusCode: string) {
  return statusLabels[statusCode] || 'Changed'
}

function parseStatusPath(rawPath: string) {
  const renameSeparator = ' -> '

  if (!rawPath.includes(renameSeparator)) {
    return { path: rawPath }
  }

  const [originalPath, ...nextPathParts] = rawPath.split(renameSeparator)

  return {
    originalPath,
    path: nextPathParts.join(renameSeparator),
  }
}

function makeStatusEntry(index: string, workingTree: string, rawPath: string, labelCode: string): GitStatusEntry {
  return {
    ...parseStatusPath(rawPath),
    index,
    workingTree,
    label: statusLabel(labelCode),
  }
}

function isConflictStatus(index: string, workingTree: string) {
  return (
    index === 'U' ||
    workingTree === 'U' ||
    (index === 'A' && workingTree === 'A') ||
    (index === 'D' && workingTree === 'D')
  )
}

async function readGitStatus(repoPath: string): Promise<GitStatusSummary> {
  const rawStatus = await tryRunGit(repoPath, ['status', '--porcelain=v1', '--branch'])
  const [branchLine = '', ...statusLines] = rawStatus.split('\n').filter(Boolean)
  const branch = branchLine.startsWith('## ') ? branchLine.slice(3) : branchLine || 'unknown'
  const summary: GitStatusSummary = {
    branch,
    clean: statusLines.length === 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    raw: rawStatus || 'Working tree clean.',
  }

  for (const statusLine of statusLines) {
    const index = statusLine[0] || ' '
    const workingTree = statusLine[1] || ' '
    const rawPath = statusLine.slice(3)

    if (index === '?' && workingTree === '?') {
      summary.untracked.push(makeStatusEntry(index, workingTree, rawPath, '?'))
      continue
    }

    if (isConflictStatus(index, workingTree)) {
      summary.conflicted.push(makeStatusEntry(index, workingTree, rawPath, 'U'))
      continue
    }

    if (index !== ' ') {
      summary.staged.push(makeStatusEntry(index, workingTree, rawPath, index))
    }

    if (workingTree !== ' ') {
      summary.unstaged.push(makeStatusEntry(index, workingTree, rawPath, workingTree))
    }
  }

  return summary
}

async function readRepositoryDetails(repoPath: string): Promise<RepositoryDetails> {
  const normalizedPath = await normalizeRepositoryPath(repoPath)
  const [summary, gitLog, gitStatus, remotes, npmScripts, packageManager] = await Promise.all([
    readRepositorySummary(normalizedPath),
    readGitLogEntries(normalizedPath),
    readGitStatus(normalizedPath),
    tryRunGit(normalizedPath, ['remote', '-v']),
    readPackageScripts(normalizedPath),
    detectPackageManager(normalizedPath),
  ])

  return {
    ...summary,
    gitLog,
    gitStatus,
    remotes: remotes || 'No git remotes configured.',
    npmScripts,
    packageManager,
  }
}

async function listRepositories() {
  const repoPaths = await readRepositoryPaths()
  return Promise.all(repoPaths.map(readRepositorySummary))
}

async function addRepository(repoPath: string) {
  const normalizedPath = await normalizeRepositoryPath(repoPath)
  const repoPaths = await readRepositoryPaths()
  const nextPaths = [normalizedPath, ...repoPaths.filter((savedPath) => savedPath !== normalizedPath)]

  await writeRepositoryPaths(nextPaths)

  return listRepositories()
}

function registerRepositoryHandlers() {
  ipcMain.handle('repositories:list', listRepositories)

  ipcMain.handle('repositories:add-by-path', (_event, repoPath: string) => addRepository(repoPath))

  ipcMain.handle('repositories:choose-and-add', async () => {
    const dialogOptions: OpenDialogOptions = {
      properties: ['openDirectory'],
      title: 'Add repository',
    }
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || !result.filePaths[0]) {
      return listRepositories()
    }

    return addRepository(result.filePaths[0])
  })

  ipcMain.handle('repositories:remove', async (_event, repoPath: string) => {
    const repoPaths = await readRepositoryPaths()
    await writeRepositoryPaths(repoPaths.filter((savedPath) => savedPath !== repoPath))

    return listRepositories()
  })

  ipcMain.handle('repositories:details', (_event, repoPath: string) => readRepositoryDetails(repoPath))

  ipcMain.handle('repositories:start-script', (_event, request: ScriptRunRequest) => startScript(request))

  ipcMain.handle('repositories:stop-script', (_event, runId: string) => stopScript(runId))

  ipcMain.on('repositories:stop-scripts', (_event, runIds: string[]) => {
    for (const runId of runIds) {
      stopScript(runId)
    }
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1180,
    minHeight: 720,
    title: 'Web Dev Companion',
    icon: path.join(process.env.VITE_PUBLIC, 'web-dev-companion.svg'),
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.js'),
    },
  })

  win.maximize()

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  stopAllScripts()

  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  registerRepositoryHandlers()
  createWindow()
})
