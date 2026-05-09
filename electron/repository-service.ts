import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  CheckoutBranchRequest,
  CheckoutSubmoduleBranchRequest,
  CommitDetails,
  CommitDetailsRequest,
  CheckoutRemoteBranchRequest,
  CommitRequest,
  DeleteBranchRequest,
  DeleteSubmoduleBranchRequest,
  GitHubRepositorySummary,
  MergeBranchRequest,
  MergeLinkedSubmoduleBranchRequest,
  OpenCommitInBrowserRequest,
  ResetTrackedChangesRequest,
  RepositoryDetails,
  RepositoryActionRequest,
  RepositorySummary,
  StatusFileDiff,
  StatusFileDiffRequest,
  StatusFileRequest,
  SyncBranchRequest,
  SyncBranchResult,
  SyncSubmoduleBranchRequest,
} from '../src/repositories'
import {
  detectPackageManager,
  fetchGitRemote,
  hasStagedOrUnstagedChanges,
  isGitAncestor,
  normalizeRepositoryPath,
  readCommitChangedFiles,
  readGitBranches,
  readGitLogEntries,
  readGitRemoteBranches,
  readGitStatus,
  readGitSubmodules,
  runGit,
  tryRunGit,
} from './git'
import {
  checkProjectOutdatedDependencies,
  readProjectHealth,
} from './project-health'
import { readProjectTasks } from './project-tasks'
import { childProcessEnv } from './process-env'

type ElectronShell = typeof import('electron').shell

const maxInlineFileDiffBytes = 500_000
const syncOperationLocks = new Map<string, Promise<void>>()
const execFileAsync = promisify(execFile)
const maxLocalRepositoryScanDepth = 6
const githubRepositoryFields = [
  'name',
  'nameWithOwner',
  'description',
  'url',
  'isPrivate',
  'isFork',
  'updatedAt',
  'primaryLanguage',
].join(',')

interface CloneGitHubRepositoryRequest {
  nameWithOwner: string
  parentDirectory: string
}

interface GitHubRepositoryPayload {
  name?: unknown
  nameWithOwner?: unknown
  description?: unknown
  url?: unknown
  isPrivate?: unknown
  isFork?: unknown
  updatedAt?: unknown
  primaryLanguage?: unknown
}

const ignoredRepositoryScanDirectoryNames = new Set([
  '.git',
  '.hg',
  '.svn',
  '.cache',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'out',
  'release',
  'target',
  'vendor',
])

function launchDetached(command: string, args: string[], cwd?: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function isCommandNotFoundError(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function commandErrorOutput(error: unknown) {
  if (error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string') {
    return error.stderr.trim()
  }

  return error instanceof Error ? error.message : 'Command failed.'
}

async function runGitHubCli(args: string[], cwd?: string, timeout = 120000) {
  try {
    const { stdout } = await execFileAsync('gh', args, {
      cwd,
      encoding: 'utf8',
      env: childProcessEnv(),
      timeout,
    })

    return stdout.trim()
  } catch (error) {
    if (isCommandNotFoundError(error)) {
      throw new Error('GitHub CLI is required to list and clone your repositories. Install gh, then run `gh auth login`.')
    }

    const output = commandErrorOutput(error)

    if (/not logged in|authentication|auth login|no github hosts/i.test(output)) {
      throw new Error('Sign in with GitHub CLI first by running `gh auth login`, then try again.')
    }

    throw new Error(output || 'GitHub CLI command failed.')
  }
}

function normalizeGitHubRepository(payload: GitHubRepositoryPayload): GitHubRepositorySummary | null {
  if (
    typeof payload.name !== 'string' ||
    typeof payload.nameWithOwner !== 'string' ||
    typeof payload.url !== 'string'
  ) {
    return null
  }

  const primaryLanguage =
    payload.primaryLanguage &&
    typeof payload.primaryLanguage === 'object' &&
    'name' in payload.primaryLanguage &&
    typeof payload.primaryLanguage.name === 'string'
      ? payload.primaryLanguage.name
      : undefined

  return {
    name: payload.name,
    nameWithOwner: payload.nameWithOwner,
    description: typeof payload.description === 'string' ? payload.description : undefined,
    url: payload.url,
    isPrivate: payload.isPrivate === true,
    isFork: payload.isFork === true,
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : undefined,
    primaryLanguage,
  }
}

function validateGitHubRepositoryName(nameWithOwner: string) {
  const trimmedName = nameWithOwner.trim()

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmedName)) {
    throw new Error('GitHub repository name must use the owner/name format.')
  }

  return trimmedName
}

function repositoryPathKey(repoPath: string) {
  const resolvedPath = path.resolve(repoPath)

  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
}

function editorCommand(requestedCommand: string | undefined) {
  const command = requestedCommand?.trim() || process.env.VISUAL || process.env.EDITOR || 'code'

  if (!command || command.includes('/') || command.includes('\\')) {
    return command
  }

  return command
}

function remoteBrowserUrl(remoteUrl: string) {
  const trimmedRemoteUrl = remoteUrl.trim()

  if (!trimmedRemoteUrl) {
    return null
  }

  if (/^https?:\/\//i.test(trimmedRemoteUrl)) {
    return trimmedRemoteUrl.replace(/\.git\/?$/, '').replace(/\/+$/, '')
  }

  try {
    const parsedUrl = new URL(trimmedRemoteUrl)

    if (parsedUrl.hostname && parsedUrl.pathname) {
      return `https://${parsedUrl.hostname}${parsedUrl.pathname}`.replace(/\.git\/?$/, '').replace(/\/+$/, '')
    }
  } catch {
    // Fall through to scp-like SSH remotes such as git@github.com:owner/repo.git.
  }

  const scpLikeMatch = trimmedRemoteUrl.match(/^(?:[^@]+@)?([^:]+):(.+)$/)

  if (!scpLikeMatch) {
    return null
  }

  const [, host, repositoryPath] = scpLikeMatch

  return `https://${host}/${repositoryPath}`.replace(/\.git\/?$/, '').replace(/\/+$/, '')
}

function commitBrowserUrl(remoteUrl: string, hash: string) {
  const browserUrl = remoteBrowserUrl(remoteUrl)

  if (!browserUrl) {
    return null
  }

  const hostname = new URL(browserUrl).hostname.toLowerCase()

  if (hostname.includes('gitlab')) {
    return `${browserUrl}/-/commit/${hash}`
  }

  if (hostname.includes('bitbucket')) {
    return `${browserUrl}/commits/${hash}`
  }

  return `${browserUrl}/commit/${hash}`
}

async function withRepositorySyncLock<T>(repoPath: string, action: () => Promise<T>) {
  const lockKey = process.platform === 'win32' ? path.resolve(repoPath).toLowerCase() : path.resolve(repoPath)
  const previousLock = syncOperationLocks.get(lockKey) ?? Promise.resolve()
  let releaseCurrentLock!: () => void
  const currentLock = new Promise<void>((resolve) => {
    releaseCurrentLock = resolve
  })
  const queuedLock = previousLock.catch(() => undefined).then(() => currentLock)

  syncOperationLocks.set(lockKey, queuedLock)
  await previousLock.catch(() => undefined)

  try {
    return await action()
  } finally {
    releaseCurrentLock()

    if (syncOperationLocks.get(lockKey) === queuedLock) {
      syncOperationLocks.delete(lockKey)
    }
  }
}

async function openWindowsTerminal(normalizedPath: string) {
  try {
    await launchDetached('wt', ['-d', normalizedPath], normalizedPath)
    return
  } catch {
    const commandPrompt = process.env.ComSpec || 'cmd.exe'
    await launchDetached(
      commandPrompt,
      ['/d', '/c', 'start', '""', commandPrompt, '/k', 'cd', '/d', normalizedPath],
      normalizedPath,
    )
  }
}

export function createRepositoryService(repositoriesFilePath: () => string, shell: ElectronShell) {
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

  async function readRepositorySummary(repoPath: string): Promise<RepositorySummary> {
    const name = path.basename(repoPath)

    try {
      const [branch, lastCommit, status, remote, projectTasks] = await Promise.all([
        tryRunGit(repoPath, ['branch', '--show-current']),
        tryRunGit(repoPath, ['log', '-1', '--pretty=format:%h %s (%cr)']),
        tryRunGit(repoPath, ['status', '--short']),
        tryRunGit(repoPath, ['remote', 'get-url', 'origin']),
        readProjectTasks(repoPath),
      ])

      return {
        path: repoPath,
        name,
        branch: branch || 'detached',
        lastCommit: lastCommit || 'No commits found',
        dirty: status.length > 0,
        taskCount: projectTasks.length,
        ecosystems: [...new Set(projectTasks.map((task) => task.source))],
        remote: remote || undefined,
      }
    } catch (error) {
      return {
        path: repoPath,
        name,
        branch: 'unknown',
        lastCommit: 'Unavailable',
        dirty: false,
        taskCount: 0,
        ecosystems: [],
        error: error instanceof Error ? error.message : 'Could not read repository.',
      }
    }
  }

  async function readRepositoryDetails(repoPath: string): Promise<RepositoryDetails> {
    const normalizedPath = await normalizeRepositoryPath(repoPath)
    const [summary, gitLog, gitStatus, gitBranches, gitSubmodules, remotes, projectTasks, packageManager] = await Promise.all([
      readRepositorySummary(normalizedPath),
      readGitLogEntries(normalizedPath),
      readGitStatus(normalizedPath),
      readGitBranches(normalizedPath),
      readGitSubmodules(normalizedPath),
      tryRunGit(normalizedPath, ['remote', '-v']),
      readProjectTasks(normalizedPath),
      detectPackageManager(normalizedPath),
    ])
    const gitRemoteBranches = await readGitRemoteBranches(normalizedPath, gitBranches)

    return {
      ...summary,
      gitLog,
      gitStatus,
      gitBranches,
      gitRemoteBranches,
      gitSubmodules,
      remotes: remotes || 'No git remotes configured.',
      projectTasks,
      packageManager,
    }
  }

  async function listRepositories() {
    const repoPaths = await readRepositoryPaths()
    return Promise.all(repoPaths.map(readRepositorySummary))
  }

  async function hasGitDirectory(directoryPath: string) {
    try {
      await fs.access(path.join(directoryPath, '.git'))
      return true
    } catch {
      return false
    }
  }

  async function scanDirectoryForRepositories(
    directoryPath: string,
    depth: number,
    foundRepositoryPaths: Map<string, string>,
  ): Promise<void> {
    if (depth > maxLocalRepositoryScanDepth) {
      return
    }

    if (await hasGitDirectory(directoryPath)) {
      try {
        const normalizedPath = await normalizeRepositoryPath(directoryPath)
        foundRepositoryPaths.set(repositoryPathKey(normalizedPath), normalizedPath)
      } catch {
        // Keep scanning sibling folders when a .git directory or worktree file is stale.
      }

      return
    }

    let entries: Array<import('node:fs').Dirent>

    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true })
    } catch {
      return
    }

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !ignoredRepositoryScanDirectoryNames.has(entry.name))
        .map((entry) => scanDirectoryForRepositories(path.join(directoryPath, entry.name), depth + 1, foundRepositoryPaths)),
    )
  }

  async function scanLocalRepositories(parentDirectory: string) {
    const normalizedParentDirectory = path.resolve(parentDirectory)
    const parentStats = await fs.stat(normalizedParentDirectory)

    if (!parentStats.isDirectory()) {
      throw new Error('Scan location must be a folder.')
    }

    const savedRepositoryPaths = new Set((await readRepositoryPaths()).map(repositoryPathKey))
    const foundRepositoryPaths = new Map<string, string>()

    await scanDirectoryForRepositories(normalizedParentDirectory, 0, foundRepositoryPaths)

    const candidatePaths = [...foundRepositoryPaths.entries()]
      .filter(([repoPathKey]) => !savedRepositoryPaths.has(repoPathKey))
      .map(([, repoPath]) => repoPath)
      .sort((repoPathA, repoPathB) => repoPathA.localeCompare(repoPathB))

    return Promise.all(candidatePaths.map(readRepositorySummary))
  }

  async function listGitHubRepositories() {
    const output = await runGitHubCli([
      'repo',
      'list',
      '--limit',
      '100',
      '--source',
      '--json',
      githubRepositoryFields,
    ])
    const parsed = JSON.parse(output) as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.flatMap((entry) => {
      const repository = normalizeGitHubRepository(entry as GitHubRepositoryPayload)
      return repository ? [repository] : []
    })
  }

  async function addRepository(repoPath: string) {
    const normalizedPath = await normalizeRepositoryPath(repoPath)
    const repoPaths = await readRepositoryPaths()
    const nextPaths = [normalizedPath, ...repoPaths.filter((savedPath) => savedPath !== normalizedPath)]

    await writeRepositoryPaths(nextPaths)

    return listRepositories()
  }

  async function cloneGitHubRepository(request: CloneGitHubRepositoryRequest) {
    const nameWithOwner = validateGitHubRepositoryName(request.nameWithOwner)
    const parentDirectory = path.resolve(request.parentDirectory)
    const parentStats = await fs.stat(parentDirectory)

    if (!parentStats.isDirectory()) {
      throw new Error('Clone destination must be a folder.')
    }

    const repositoryName = nameWithOwner.split('/').pop() ?? ''
    const targetPath = path.resolve(parentDirectory, repositoryName)
    const relativeTargetPath = path.relative(parentDirectory, targetPath)

    if (relativeTargetPath.startsWith('..') || path.isAbsolute(relativeTargetPath)) {
      throw new Error('Clone destination must stay inside the selected folder.')
    }

    try {
      await fs.access(targetPath)
      throw new Error(`A folder named "${repositoryName}" already exists in the selected destination.`)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error
      }
    }

    await runGitHubCli(['repo', 'clone', nameWithOwner, targetPath], parentDirectory, 600000)

    return addRepository(targetPath)
  }

  async function removeRepository(repoPath: string) {
    const repoPaths = await readRepositoryPaths()
    await writeRepositoryPaths(repoPaths.filter((savedPath) => savedPath !== repoPath))

    return listRepositories()
  }

  async function openInFileManager(request: RepositoryActionRequest) {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const errorMessage = await shell.openPath(normalizedPath)

    if (errorMessage) {
      throw new Error(errorMessage)
    }

    return true
  }

  async function openInEditor(request: RepositoryActionRequest) {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    await launchDetached(editorCommand(request.editorCommand), [normalizedPath], normalizedPath)
    return true
  }

  async function openInTerminal(request: RepositoryActionRequest) {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)

    if (process.platform === 'darwin') {
      await launchDetached('open', ['-a', 'Terminal', normalizedPath], normalizedPath)
      return true
    }

    if (process.platform === 'win32') {
      await openWindowsTerminal(normalizedPath)
      return true
    }

    await launchDetached(process.env.TERMINAL || 'x-terminal-emulator', [], normalizedPath)
    return true
  }

  async function openCommitInBrowser(request: OpenCommitInBrowserRequest) {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const hash = request.hash.trim()

    if (!hash) {
      throw new Error('Commit hash is required.')
    }

    const [remoteUrl, fullHash] = await Promise.all([
      tryRunGit(normalizedPath, ['remote', 'get-url', 'origin']),
      runGit(normalizedPath, ['rev-parse', '--verify', `${hash}^{commit}`]),
    ])

    if (!remoteUrl) {
      throw new Error('No origin remote is configured for this repository.')
    }

    const browserUrl = commitBrowserUrl(remoteUrl, fullHash)

    if (!browserUrl) {
      throw new Error('Origin remote could not be converted to a browser URL.')
    }

    await shell.openExternal(browserUrl)

    return true
  }

  async function health(repoPath: string) {
    const normalizedPath = await normalizeRepositoryPath(repoPath)

    return readProjectHealth(normalizedPath)
  }

  async function checkOutdatedDependencies(repoPath: string) {
    const normalizedPath = await normalizeRepositoryPath(repoPath)

    return checkProjectOutdatedDependencies(normalizedPath)
  }

  async function deleteBranch(request: DeleteBranchRequest): Promise<RepositoryDetails> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const branchName = request.branchName.trim()

    if (!branchName) {
      throw new Error('Branch name is required.')
    }

    const branch = (await readGitBranches(normalizedPath)).find((entry) => entry.name === branchName)

    if (!branch) {
      throw new Error(`Branch "${branchName}" was not found.`)
    }

    if (!branch.canDelete) {
      throw new Error(branch.deleteReason || 'Branch cannot be deleted.')
    }

    await runGit(normalizedPath, ['branch', '-D', '--', branchName])

    return readRepositoryDetails(normalizedPath)
  }

  async function resolveSubmodulePath(normalizedPath: string, submodulePath: string) {
    const cleanSubmodulePath = submodulePath.trim()

    if (!cleanSubmodulePath) {
      throw new Error('Submodule path is required.')
    }

    const submodule = (await readGitSubmodules(normalizedPath)).find((entry) => entry.path === cleanSubmodulePath)

    if (!submodule) {
      throw new Error(`Submodule "${cleanSubmodulePath}" was not found.`)
    }

    const absoluteSubmodulePath = path.resolve(normalizedPath, submodule.path)
    const relativeSubmodulePath = path.relative(normalizedPath, absoluteSubmodulePath)

    if (relativeSubmodulePath.startsWith('..') || path.isAbsolute(relativeSubmodulePath)) {
      throw new Error('Submodule path must stay inside the repository.')
    }

    return {
      absoluteSubmodulePath,
      submodule,
    }
  }

  async function deleteSubmoduleBranch(request: DeleteSubmoduleBranchRequest): Promise<RepositoryDetails> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const branchName = request.branchName.trim()

    if (!branchName) {
      throw new Error('Branch name is required.')
    }

    const { absoluteSubmodulePath, submodule } = await resolveSubmodulePath(normalizedPath, request.submodulePath)
    const branch = submodule.branches.find((entry) => entry.name === branchName)

    if (!branch) {
      throw new Error(`Submodule branch "${branchName}" was not found.`)
    }

    if (!branch.canDelete) {
      throw new Error(branch.deleteReason || 'Submodule branch cannot be deleted.')
    }

    await runGit(absoluteSubmodulePath, ['branch', '-D', '--', branchName])

    return readRepositoryDetails(normalizedPath)
  }

  async function assertCleanWorkingTreeForCheckout(normalizedPath: string) {
    const gitStatus = await readGitStatus(normalizedPath)

    if (!gitStatus.clean) {
      throw new Error('Commit, stash, or discard working tree changes before switching branches.')
    }
  }

  async function checkoutBranch(request: CheckoutBranchRequest): Promise<RepositoryDetails> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const branchName = request.branchName.trim()

    if (!branchName) {
      throw new Error('Branch name is required.')
    }

    await assertCleanWorkingTreeForCheckout(normalizedPath)

    const branch = (await readGitBranches(normalizedPath)).find((entry) => entry.name === branchName)

    if (!branch) {
      throw new Error(`Branch "${branchName}" was not found.`)
    }

    if (!branch.current) {
      await runGit(normalizedPath, ['switch', '--', branchName], 120000)
    }

    return readRepositoryDetails(normalizedPath)
  }

  async function checkoutSubmoduleBranch(request: CheckoutSubmoduleBranchRequest): Promise<RepositoryDetails> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const branchName = request.branchName.trim()

    if (!branchName) {
      throw new Error('Branch name is required.')
    }

    const { absoluteSubmodulePath, submodule } = await resolveSubmodulePath(normalizedPath, request.submodulePath)
    const branch = submodule.branches.find((entry) => entry.name === branchName)

    if (!branch) {
      throw new Error(`Submodule branch "${branchName}" was not found.`)
    }

    await assertCleanWorkingTreeForCheckout(absoluteSubmodulePath)

    if (!branch.current) {
      await runGit(absoluteSubmodulePath, ['switch', '--', branchName], 120000)
    }

    return readRepositoryDetails(normalizedPath)
  }

  async function checkoutRemoteBranch(request: CheckoutRemoteBranchRequest): Promise<RepositoryDetails> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const remoteBranchName = request.remoteBranchName.trim()

    if (!remoteBranchName) {
      throw new Error('Remote branch name is required.')
    }

    await assertCleanWorkingTreeForCheckout(normalizedPath)

    const localBranches = await readGitBranches(normalizedPath)
    const remoteBranch = (await readGitRemoteBranches(normalizedPath, localBranches))
      .find((entry) => entry.name === remoteBranchName)

    if (!remoteBranch) {
      throw new Error(`Remote branch "${remoteBranchName}" was not found.`)
    }

    const localBranchName = request.localBranchName?.trim() || remoteBranch.localName

    if (!localBranchName) {
      throw new Error('Local branch name is required.')
    }

    if (localBranches.some((branch) => branch.name === localBranchName)) {
      throw new Error(`Local branch "${localBranchName}" already exists.`)
    }

    await runGit(normalizedPath, ['switch', '--track', '-c', localBranchName, remoteBranch.name], 120000)

    return readRepositoryDetails(normalizedPath)
  }

  async function syncBranchInRepository(repoPath: string, branchName: string) {
    return withRepositorySyncLock(repoPath, async () => {
      const [gitStatus, branches] = await Promise.all([readGitStatus(repoPath), readGitBranches(repoPath)])

      if (hasStagedOrUnstagedChanges(gitStatus)) {
        throw new Error('Commit, stash, or discard staged and unstaged changes before syncing branches.')
      }

      const branch = branches.find((entry) => entry.name === branchName)

      if (!branch) {
        throw new Error(`Branch "${branchName}" was not found.`)
      }

      if (!branch.upstream) {
        throw new Error(`Branch "${branchName}" has no upstream remote branch.`)
      }

      if (branch.remoteGone) {
        throw new Error(`Branch "${branchName}" tracks a remote branch that is gone.`)
      }

      const remoteName = await runGit(repoPath, ['config', '--get', `branch.${branchName}.remote`])

      if (!remoteName || remoteName === '.') {
        throw new Error(`Branch "${branchName}" does not track a remote branch.`)
      }

      const upstreamMergeRef = await runGit(repoPath, ['config', '--get', `branch.${branchName}.merge`])

      if (!upstreamMergeRef) {
        throw new Error(`Branch "${branchName}" does not track a remote branch.`)
      }

      await fetchGitRemote(repoPath, remoteName)

      const refreshedBranch = (await readGitBranches(repoPath)).find((entry) => entry.name === branchName)

      if (!refreshedBranch) {
        throw new Error(`Branch "${branchName}" was not found.`)
      }

      if (refreshedBranch.remoteGone) {
        throw new Error(`Branch "${branchName}" tracks a remote branch that is gone.`)
      }

      const branchRef = `refs/heads/${branchName}`
      const localCommit = await runGit(repoPath, ['rev-parse', '--verify', branchRef])
      const upstreamCommit = await runGit(repoPath, ['rev-parse', '--verify', `${branchName}@{upstream}`])

      if (localCommit === upstreamCommit) {
        return false
      }

      if (await isGitAncestor(repoPath, localCommit, upstreamCommit)) {
        if (refreshedBranch.current) {
          await runGit(repoPath, ['merge', '--ff-only', `${branchName}@{upstream}`], 120000)
          return false
        }

        await runGit(repoPath, ['update-ref', branchRef, upstreamCommit, localCommit], 120000)
        return false
      }

      if (await isGitAncestor(repoPath, upstreamCommit, localCommit)) {
        await runGit(repoPath, ['push', remoteName, `${branchRef}:${upstreamMergeRef}`], 120000)
        return true
      }

      throw new Error(`Branch "${branchName}" has both local and remote commits. Resolve it manually before syncing.`)
    })
  }

  async function syncBranch(request: SyncBranchRequest): Promise<SyncBranchResult> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const branchName = request.branchName.trim()

    if (!branchName) {
      throw new Error('Branch name is required.')
    }

    const pushed = await syncBranchInRepository(normalizedPath, branchName)

    return {
      details: await readRepositoryDetails(normalizedPath),
      pushed,
    }
  }

  async function syncSubmoduleBranch(request: SyncSubmoduleBranchRequest): Promise<SyncBranchResult> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const branchName = request.branchName.trim()

    if (!branchName) {
      throw new Error('Branch name is required.')
    }

    const { absoluteSubmodulePath } = await resolveSubmodulePath(normalizedPath, request.submodulePath)
    const pushed = await syncBranchInRepository(absoluteSubmodulePath, branchName)

    return {
      details: await readRepositoryDetails(normalizedPath),
      pushed,
    }
  }

  function cleanBranchName(branchName: string, label: string) {
    const trimmedBranchName = branchName.trim()

    if (!trimmedBranchName) {
      throw new Error(`${label} is required.`)
    }

    return trimmedBranchName
  }

  async function assertBranchExists(repoPath: string, branchName: string, label: string) {
    await runGit(repoPath, ['rev-parse', '--verify', `refs/heads/${branchName}`])
      .catch(() => {
        throw new Error(`${label} "${branchName}" was not found.`)
      })
  }

  async function assertNoMergeInProgress(repoPath: string, label: string) {
    const mergeHead = await tryRunGit(repoPath, ['rev-parse', '--verify', 'MERGE_HEAD'])

    if (mergeHead) {
      throw new Error(`Finish or abort the in-progress merge in ${label} before starting another merge.`)
    }
  }

  async function assertCleanSubmoduleWorkingTree(submodulePath: string, submoduleLabel: string) {
    const status = await tryRunGit(submodulePath, ['status', '--porcelain=v1'])

    if (status) {
      throw new Error(`Commit, stash, or discard changes in ${submoduleLabel} before merging linked branches.`)
    }
  }

  async function pullCurrentTargetBranch(repoPath: string, branchName: string, label: string) {
    const branch = (await readGitBranches(repoPath)).find((entry) => entry.name === branchName)

    if (!branch) {
      throw new Error(`${label} "${branchName}" was not found.`)
    }

    if (branch.remoteGone) {
      throw new Error(`${label} "${branchName}" tracks a remote branch that is gone.`)
    }

    if (!branch.upstream) {
      throw new Error(`${label} "${branchName}" has no upstream remote branch to pull from.`)
    }

    await runGit(repoPath, ['pull', '--ff-only'], 120000)
  }

  async function commitPendingMerge(repoPath: string, fallbackMessage: string) {
    const mergeHead = await tryRunGit(repoPath, ['rev-parse', '--verify', 'MERGE_HEAD'])

    if (mergeHead) {
      await runGit(repoPath, ['commit', '--no-edit'], 120000)
      return
    }

    const stagedPaths = await tryRunGit(repoPath, ['diff', '--cached', '--name-only'])

    if (stagedPaths) {
      await runGit(repoPath, ['commit', '-m', fallbackMessage], 120000)
    }
  }

  async function mergeLinkedSubmoduleBranch(request: MergeLinkedSubmoduleBranchRequest): Promise<RepositoryDetails> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const sourceParentBranch = cleanBranchName(request.sourceParentBranch, 'Source parent branch')
    const targetParentBranch = cleanBranchName(request.targetParentBranch, 'Target parent branch')
    const routes = request.routes.map((route) => ({
      ...route,
      sourceSubmoduleBranch: cleanBranchName(route.sourceSubmoduleBranch, 'Source submodule branch'),
      targetSubmoduleBranch: cleanBranchName(route.targetSubmoduleBranch, 'Target submodule branch'),
    }))

    if (routes.length === 0) {
      throw new Error('Choose at least one linked submodule route to merge.')
    }

    const resolvedRoutes = await Promise.all(
      routes.map(async (route) => {
        const { absoluteSubmodulePath, submodule } = await resolveSubmodulePath(normalizedPath, route.submodulePath)

        return {
          ...route,
          absoluteSubmodulePath,
          submodule,
        }
      }),
    )

    await Promise.all([
      assertBranchExists(normalizedPath, sourceParentBranch, 'Source parent branch'),
      assertBranchExists(normalizedPath, targetParentBranch, 'Target parent branch'),
      assertNoMergeInProgress(normalizedPath, 'the parent repository'),
      ...resolvedRoutes.flatMap((route) => [
        assertBranchExists(route.absoluteSubmodulePath, route.sourceSubmoduleBranch, 'Source submodule branch'),
        assertBranchExists(route.absoluteSubmodulePath, route.targetSubmoduleBranch, 'Target submodule branch'),
        assertNoMergeInProgress(route.absoluteSubmodulePath, route.submodule.path),
      ]),
    ])

    await assertCleanWorkingTreeForCheckout(normalizedPath)
    await Promise.all(
      resolvedRoutes.map((route) =>
        assertCleanSubmoduleWorkingTree(route.absoluteSubmodulePath, route.submodule.path),
      ),
    )

    await runGit(normalizedPath, ['switch', '--', targetParentBranch], 120000)
    await pullCurrentTargetBranch(normalizedPath, targetParentBranch, 'Target parent branch')
    await runGit(normalizedPath, [
      'submodule',
      'update',
      '--init',
      '--',
      ...resolvedRoutes.map((route) => route.submodule.path),
    ], 120000)
    await runGit(normalizedPath, ['merge', '--no-ff', '--no-commit', sourceParentBranch], 120000)

    for (const route of resolvedRoutes) {
      await runGit(route.absoluteSubmodulePath, ['switch', '--', route.targetSubmoduleBranch], 120000)
      await pullCurrentTargetBranch(route.absoluteSubmodulePath, route.targetSubmoduleBranch, 'Target submodule branch')
      await runGit(route.absoluteSubmodulePath, ['merge', '--no-edit', route.sourceSubmoduleBranch], 120000)
      await runGit(normalizedPath, ['add', '--', route.submodule.path], 120000)
    }

    await commitPendingMerge(
      normalizedPath,
      `Merge linked branches from ${sourceParentBranch} into ${targetParentBranch}`,
    )

    return readRepositoryDetails(normalizedPath)
  }

  async function mergeBranch(request: MergeBranchRequest): Promise<RepositoryDetails> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const sourceBranch = cleanBranchName(request.sourceBranch, 'Source branch')
    const targetBranch = cleanBranchName(request.targetBranch, 'Target branch')

    if (sourceBranch === targetBranch) {
      throw new Error('Choose different source and target branches.')
    }

    await Promise.all([
      assertBranchExists(normalizedPath, sourceBranch, 'Source branch'),
      assertBranchExists(normalizedPath, targetBranch, 'Target branch'),
      assertNoMergeInProgress(normalizedPath, 'the repository'),
    ])

    await assertCleanWorkingTreeForCheckout(normalizedPath)
    await runGit(normalizedPath, ['switch', '--', targetBranch], 120000)
    await pullCurrentTargetBranch(normalizedPath, targetBranch, 'Target branch')
    await runGit(normalizedPath, ['merge', '--no-ff', '--no-edit', sourceBranch], 120000)

    return readRepositoryDetails(normalizedPath)
  }

  function normalizeStatusPaths(paths: string[]) {
    const normalizedPaths = [...new Set(paths.map((statusPath) => statusPath.trim()).filter(Boolean))]

    if (normalizedPaths.length === 0) {
      throw new Error('Choose at least one file.')
    }

    return normalizedPaths
  }

  async function readUntrackedFileDiff(repoPath: string, statusPath: string): Promise<string> {
    const absoluteFilePath = path.resolve(repoPath, statusPath)
    const relativePath = path.relative(repoPath, absoluteFilePath)

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error('File path must stay inside the repository.')
    }

    const stats = await fs.stat(absoluteFilePath)

    if (!stats.isFile()) {
      return `Untracked path is not a regular file: ${statusPath}`
    }

    if (stats.size > maxInlineFileDiffBytes) {
      return `Untracked file is too large to preview (${Math.ceil(stats.size / 1024)} KB).`
    }

    const content = await fs.readFile(absoluteFilePath, 'utf8')

    return [
      `--- /dev/null`,
      `+++ b/${statusPath}`,
      '@@ untracked file @@',
      ...content.split('\n').map((line) => `+${line}`),
    ].join('\n')
  }

  async function diffFile(request: StatusFileDiffRequest): Promise<StatusFileDiff> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const [statusPath] = normalizeStatusPaths([request.path])
    let content = ''

    if (request.diffType === 'staged') {
      content = await tryRunGit(normalizedPath, ['diff', '--cached', '--no-ext-diff', '--', statusPath])
    } else if (request.diffType === 'untracked') {
      content = await readUntrackedFileDiff(normalizedPath, statusPath)
    } else {
      content = await tryRunGit(normalizedPath, ['diff', '--no-ext-diff', '--', statusPath])
    }

    return {
      path: statusPath,
      diffType: request.diffType,
      content: content || 'No diff output available for this file.',
    }
  }

  async function readCommitDetails(request: CommitDetailsRequest): Promise<CommitDetails> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const commitHash = request.hash.trim()

    if (!commitHash) {
      throw new Error('Commit hash is required.')
    }

    const fullHash = await runGit(normalizedPath, ['rev-parse', '--verify', `${commitHash}^{commit}`])
    const fieldSeparator = '\x1f'
    const detailsOutput = await runGit(normalizedPath, [
      'show',
      '--no-patch',
      `--format=%H%x1f%h%x1f%cr%x1f%cI%x1f%an%x1f%ae%x1f%s%x1f%b`,
      fullHash,
    ])
    const [resolvedHash = fullHash, shortHash = commitHash, time = '', dateTime = '', authorName = '', authorEmail = '', message = '', ...bodyParts] =
      detailsOutput.split(fieldSeparator)
    const [files, diff] = await Promise.all([
      readCommitChangedFiles(normalizedPath, resolvedHash),
      tryRunGit(normalizedPath, [
        'show',
        '--format=',
        '--patch',
        '--no-ext-diff',
        '--find-renames',
        '--find-copies',
        resolvedHash,
      ]),
    ])

    return {
      fullHash: resolvedHash,
      hash: shortHash,
      time,
      dateTime,
      authorName,
      authorEmail,
      message,
      body: bodyParts.join(fieldSeparator).trim(),
      files,
      diff: diff || 'No diff output available for this commit.',
    }
  }

  async function stageFiles(request: StatusFileRequest): Promise<RepositoryDetails> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const statusPaths = normalizeStatusPaths(request.paths)

    await runGit(normalizedPath, ['add', '--', ...statusPaths])

    return readRepositoryDetails(normalizedPath)
  }

  async function unstageFiles(request: StatusFileRequest): Promise<RepositoryDetails> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const statusPaths = normalizeStatusPaths(request.paths)

    await runGit(normalizedPath, ['restore', '--staged', '--', ...statusPaths])

    return readRepositoryDetails(normalizedPath)
  }

  async function pathExistsInHead(repoPath: string, statusPath: string) {
    const output = await tryRunGit(repoPath, ['ls-tree', '-r', '--name-only', 'HEAD', '--', statusPath])

    return output.split(/\r?\n/).includes(statusPath)
  }

  async function resetTrackedChanges(request: ResetTrackedChangesRequest): Promise<RepositoryDetails> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)

    if (request.paths?.length) {
      const statusPaths = normalizeStatusPaths(request.paths)
      const pathsInHead: string[] = []

      for (const statusPath of statusPaths) {
        if (await pathExistsInHead(normalizedPath, statusPath)) {
          pathsInHead.push(statusPath)
        }
      }

      await runGit(normalizedPath, ['reset', '--', ...statusPaths])

      if (pathsInHead.length > 0) {
        await runGit(normalizedPath, ['restore', '--source=HEAD', '--worktree', '--', ...pathsInHead])
      }

      return readRepositoryDetails(normalizedPath)
    }

    await runGit(normalizedPath, ['reset', '--hard', 'HEAD'])

    return readRepositoryDetails(normalizedPath)
  }

  async function commit(request: CommitRequest): Promise<RepositoryDetails> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const message = request.message.trim()

    if (!message) {
      throw new Error('Commit message is required.')
    }

    const gitStatus = await readGitStatus(normalizedPath)

    if (gitStatus.conflicted.length > 0) {
      throw new Error('Resolve conflicts before committing.')
    }

    if (gitStatus.staged.length === 0) {
      throw new Error('Stage at least one file before committing.')
    }

    await runGit(normalizedPath, ['commit', '-m', message], 120000)

    return readRepositoryDetails(normalizedPath)
  }

  return {
    addRepository,
    checkOutdatedDependencies,
    checkoutBranch,
    checkoutSubmoduleBranch,
    checkoutRemoteBranch,
    cloneGitHubRepository,
    commit,
    deleteBranch,
    deleteSubmoduleBranch,
    diffFile,
    health,
    listGitHubRepositories,
    mergeBranch,
    mergeLinkedSubmoduleBranch,
    openCommitInBrowser,
    readCommitDetails,
    listRepositories,
    openInEditor,
    openInFileManager,
    openInTerminal,
    readRepositoryDetails,
    removeRepository,
    scanLocalRepositories,
    stageFiles,
    resetTrackedChanges,
    syncBranch,
    syncSubmoduleBranch,
    unstageFiles,
  }
}
