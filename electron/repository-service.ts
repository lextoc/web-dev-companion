import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type {
  CommitRequest,
  DeleteBranchRequest,
  RepositoryDetails,
  RepositoryActionRequest,
  RepositorySummary,
  StatusFileRequest,
  SyncBranchRequest,
} from '../src/repositories'
import {
  detectPackageManager,
  hasStagedOrUnstagedChanges,
  isGitAncestor,
  normalizeRepositoryPath,
  readGitBranches,
  readGitLogEntries,
  readGitStatus,
  readPackageScripts,
  runGit,
  tryRunGit,
} from './git'

type ElectronShell = typeof import('electron').shell

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

function editorCommand(requestedCommand: string | undefined) {
  const command = requestedCommand?.trim() || process.env.VISUAL || process.env.EDITOR || 'code'

  if (!command || command.includes('/') || command.includes('\\')) {
    return command
  }

  return command
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

  async function readRepositoryDetails(repoPath: string): Promise<RepositoryDetails> {
    const normalizedPath = await normalizeRepositoryPath(repoPath)
    const [summary, gitLog, gitStatus, gitBranches, remotes, npmScripts, packageManager] = await Promise.all([
      readRepositorySummary(normalizedPath),
      readGitLogEntries(normalizedPath),
      readGitStatus(normalizedPath),
      readGitBranches(normalizedPath),
      tryRunGit(normalizedPath, ['remote', '-v']),
      readPackageScripts(normalizedPath),
      detectPackageManager(normalizedPath),
    ])

    return {
      ...summary,
      gitLog,
      gitStatus,
      gitBranches,
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
      await launchDetached('wt', ['-d', normalizedPath], normalizedPath)
      return true
    }

    await launchDetached(process.env.TERMINAL || 'x-terminal-emulator', [], normalizedPath)
    return true
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

  async function syncBranch(request: SyncBranchRequest): Promise<RepositoryDetails> {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath)
    const branchName = request.branchName.trim()

    if (!branchName) {
      throw new Error('Branch name is required.')
    }

    const [gitStatus, branches] = await Promise.all([readGitStatus(normalizedPath), readGitBranches(normalizedPath)])

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

    if (branch.current) {
      await runGit(normalizedPath, ['pull', '--ff-only'], 120000)
      return readRepositoryDetails(normalizedPath)
    }

    const remoteName = await runGit(normalizedPath, ['config', '--get', `branch.${branchName}.remote`])

    if (!remoteName || remoteName === '.') {
      throw new Error(`Branch "${branchName}" does not track a remote branch.`)
    }

    await runGit(normalizedPath, ['fetch', remoteName], 120000)

    const branchRef = `refs/heads/${branchName}`
    const localCommit = await runGit(normalizedPath, ['rev-parse', '--verify', branchRef])
    const upstreamCommit = await runGit(normalizedPath, ['rev-parse', '--verify', `${branchName}@{upstream}`])

    if (localCommit === upstreamCommit || (await isGitAncestor(normalizedPath, upstreamCommit, localCommit))) {
      return readRepositoryDetails(normalizedPath)
    }

    if (!(await isGitAncestor(normalizedPath, localCommit, upstreamCommit))) {
      throw new Error(`Branch "${branchName}" cannot be fast-forwarded from ${branch.upstream}.`)
    }

    await runGit(normalizedPath, ['update-ref', branchRef, upstreamCommit, localCommit], 120000)

    return readRepositoryDetails(normalizedPath)
  }

  function normalizeStatusPaths(paths: string[]) {
    const normalizedPaths = [...new Set(paths.map((statusPath) => statusPath.trim()).filter(Boolean))]

    if (normalizedPaths.length === 0) {
      throw new Error('Choose at least one file.')
    }

    return normalizedPaths
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
    commit,
    deleteBranch,
    listRepositories,
    openInEditor,
    openInFileManager,
    openInTerminal,
    readRepositoryDetails,
    removeRepository,
    stageFiles,
    syncBranch,
    unstageFiles,
  }
}
