import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  GitBranchEntry,
  GitCommandLogEntry,
  CommitChangedFile,
  GitLogEntry,
  GitRemoteBranchEntry,
  GitStatusEntry,
  GitStatusSummary,
  GitSubmoduleEntry,
} from '../src/repositories'
import { childProcessEnv } from './process-env'

const execFileAsync = promisify(execFile)
let nextGitCommandLogId = 0
let gitCommandLogListener: ((entry: GitCommandLogEntry) => void) | undefined

export function onGitCommandLog(listener: (entry: GitCommandLogEntry) => void) {
  gitCommandLogListener = listener
}

function quoteGitArg(arg: string) {
  if (/^[A-Za-z0-9_./:=@{}+-]+$/.test(arg)) {
    return arg
  }

  return `'${arg.replace(/'/g, "'\\''")}'`
}

function commandText(args: string[]) {
  return ['git', ...args.map(quoteGitArg)].join(' ')
}

function emitGitCommandLog(entry: Omit<GitCommandLogEntry, 'id'>) {
  gitCommandLogListener?.({
    ...entry,
    id: `git-command-${Date.now()}-${nextGitCommandLogId++}`,
  })
}

export async function runGit(repoPath: string, args: string[], timeout = 5000) {
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  const command = commandText(args)

  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repoPath,
      encoding: 'utf8',
      env: childProcessEnv(),
      timeout,
    })

    emitGitCommandLog({
      command,
      durationMs: Date.now() - startedAtMs,
      ok: true,
      repoPath,
      startedAt,
    })

    return stdout.trim()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Git command failed.'

    emitGitCommandLog({
      command,
      durationMs: Date.now() - startedAtMs,
      error: message,
      ok: false,
      repoPath,
      startedAt,
    })

    if (error instanceof Error) {
      throw new Error(error.message)
    }

    throw error
  }
}

export async function tryRunGit(repoPath: string, args: string[]) {
  try {
    return await runGit(repoPath, args)
  } catch {
    return ''
  }
}

export async function normalizeRepositoryPath(repoPath: string) {
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

export async function readPackageScripts(repoPath: string) {
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

export async function detectPackageManager(repoPath: string) {
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

export async function readGitLogEntries(repoPath: string): Promise<GitLogEntry[]> {
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

function parseNumberStat(value: string) {
  if (value === '-') {
    return undefined
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : undefined
}

function commitFileStatusLabel(status: string) {
  const statusCode = status[0] || ''

  if (statusCode === 'M') {
    return 'Modified'
  }

  if (statusCode === 'A') {
    return 'Added'
  }

  if (statusCode === 'D') {
    return 'Deleted'
  }

  if (statusCode === 'R') {
    return 'Renamed'
  }

  if (statusCode === 'C') {
    return 'Copied'
  }

  return 'Changed'
}

export async function readCommitChangedFiles(repoPath: string, commitHash: string): Promise<CommitChangedFile[]> {
  const [nameStatusOutput, numstatOutput] = await Promise.all([
    tryRunGit(repoPath, ['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', '-M', '-C', commitHash]),
    tryRunGit(repoPath, ['diff-tree', '--no-commit-id', '--numstat', '-r', '--root', '-M', '-C', commitHash]),
  ])
  const statsByPath = new Map<string, Pick<CommitChangedFile, 'additions' | 'deletions'>>()
  const statsList: Array<Pick<CommitChangedFile, 'additions' | 'deletions'>> = []

  for (const line of numstatOutput.split('\n').filter(Boolean)) {
    const [additions = '', deletions = '', ...pathParts] = line.split('\t')
    const changedPath = pathParts[pathParts.length - 1]
    const stats = {
      additions: parseNumberStat(additions),
      deletions: parseNumberStat(deletions),
    }

    if (!changedPath) {
      continue
    }

    statsByPath.set(changedPath, stats)
    statsList.push(stats)
  }

  return nameStatusOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [rawStatus = '', firstPath = '', secondPath = ''] = line.split('\t')
      const path = secondPath || firstPath
      const originalPath = secondPath ? firstPath : undefined
      const stats = statsByPath.get(path) ?? statsList[index]

      return {
        path,
        originalPath,
        status: commitFileStatusLabel(rawStatus),
        additions: stats?.additions,
        deletions: stats?.deletions,
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

export function hasStagedOrUnstagedChanges(gitStatus: GitStatusSummary) {
  return gitStatus.staged.length > 0 || gitStatus.unstaged.length > 0 || gitStatus.conflicted.length > 0
}

export async function isGitAncestor(repoPath: string, ancestor: string, descendant: string) {
  try {
    await runGit(repoPath, ['merge-base', '--is-ancestor', ancestor, descendant])
    return true
  } catch {
    return false
  }
}

export async function readGitStatus(repoPath: string): Promise<GitStatusSummary> {
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

function parseTrackingStatus(trackingStatus: string) {
  const aheadMatch = trackingStatus.match(/ahead (\d+)/)
  const behindMatch = trackingStatus.match(/behind (\d+)/)

  return {
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
    remoteGone: trackingStatus === 'gone',
  }
}

function branchDeleteReason(branch: Pick<GitBranchEntry, 'current' | 'upstream' | 'ahead' | 'behind' | 'remoteGone'>) {
  if (branch.current) {
    return 'Current branch cannot be deleted.'
  }

  if (!branch.upstream) {
    return 'No upstream remote branch is configured.'
  }

  if (branch.remoteGone) {
    return 'Upstream remote branch is gone.'
  }

  if (branch.ahead > 0 || branch.behind > 0) {
    return 'Branch is not in sync with its remote.'
  }

  return undefined
}

export async function readGitBranches(repoPath: string): Promise<GitBranchEntry[]> {
  const fieldSeparator = '\0'
  const output = await tryRunGit(repoPath, [
    'for-each-ref',
    'refs/heads',
    `--format=%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(upstream:track,nobracket)`,
    '--sort=refname',
  ])

  if (!output) {
    return []
  }

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [head = '', name = '', upstream = '', trackingStatus = ''] = line.split(fieldSeparator)
      const { ahead, behind, remoteGone } = parseTrackingStatus(trackingStatus)
      const branch = {
        name,
        upstream: upstream || undefined,
        current: head === '*',
        ahead,
        behind,
        remoteGone,
      }
      const deleteReason = branchDeleteReason(branch)

      return {
        ...branch,
        inSyncWithRemote: Boolean(branch.upstream) && !remoteGone && ahead === 0 && behind === 0,
        canDelete: !deleteReason,
        deleteReason,
      }
    })
}

export async function readGitRemoteBranches(
  repoPath: string,
  localBranches: GitBranchEntry[],
): Promise<GitRemoteBranchEntry[]> {
  const output = await tryRunGit(repoPath, [
    'for-each-ref',
    'refs/remotes',
    '--format=%(refname:short)',
    '--sort=refname',
  ])
  const localBranchNames = new Set(localBranches.map((branch) => branch.name))

  if (!output) {
    return []
  }

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name && !name.endsWith('/HEAD'))
    .map((name) => {
      const [remote, ...localNameParts] = name.split('/')
      const localName = localNameParts.join('/')

      return {
        name,
        remote,
        localName,
        hasLocalBranch: localBranchNames.has(localName),
      }
    })
}

export async function readGitSubmodules(repoPath: string): Promise<GitSubmoduleEntry[]> {
  try {
    await fs.access(path.join(repoPath, '.gitmodules'))
  } catch {
    return []
  }

  const output = await tryRunGit(repoPath, [
    'config',
    '--file',
    '.gitmodules',
    '--get-regexp',
    '^submodule\\..*\\.path$',
  ])

  if (!output) {
    return []
  }

  const submoduleEntries = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key = '', ...pathParts] = line.split(/\s+/)
      const submodulePath = pathParts.join(' ')
      const name = key.replace(/^submodule\./, '').replace(/\.path$/, '').replace(/^"|"$/g, '')

      return {
        name,
        path: submodulePath,
      }
    })
    .filter((entry) => entry.path)

  return Promise.all(
    submoduleEntries.map(async (entry) => {
      const submodulePath = path.join(repoPath, entry.path)
      const [branch, status, branches] = await Promise.all([
        tryRunGit(submodulePath, ['branch', '--show-current']),
        tryRunGit(submodulePath, ['status', '--porcelain=v1']),
        readGitBranches(submodulePath),
      ])

      return {
        ...entry,
        branch: branch || 'detached',
        dirty: status.length > 0,
        branches: branches.map((submoduleBranch) => ({
          ...submoduleBranch,
          canDelete: !submoduleBranch.current,
          deleteReason: submoduleBranch.current ? 'Current submodule branch cannot be deleted.' : undefined,
        })),
      }
    }),
  )
}
