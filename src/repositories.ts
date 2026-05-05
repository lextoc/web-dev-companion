export interface RepositorySummary {
  path: string
  name: string
  branch: string
  lastCommit: string
  dirty: boolean
  npmScriptCount: number
  remote?: string
  error?: string
}

export interface GitLogEntry {
  hash: string
  time: string
  dateTime: string
  authorName: string
  authorEmail: string
  message: string
}

export interface RepositoryGitLogEntry extends GitLogEntry {
  repoPath: string
  repoName: string
}

export interface GitStatusEntry {
  path: string
  originalPath?: string
  index: string
  workingTree: string
  label: string
}

export interface GitStatusSummary {
  branch: string
  clean: boolean
  staged: GitStatusEntry[]
  unstaged: GitStatusEntry[]
  untracked: GitStatusEntry[]
  conflicted: GitStatusEntry[]
  raw: string
}

export interface GitBranchEntry {
  name: string
  upstream?: string
  current: boolean
  ahead: number
  behind: number
  remoteGone: boolean
  inSyncWithRemote: boolean
  canDelete: boolean
  deleteReason?: string
}

export interface RepositoryDetails extends RepositorySummary {
  gitLog: GitLogEntry[]
  gitStatus: GitStatusSummary
  gitBranches: GitBranchEntry[]
  remotes: string
  npmScripts: Record<string, string>
  packageManager?: string
}

export interface DeleteBranchRequest {
  repoPath: string
  branchName: string
}

export interface SyncBranchRequest {
  repoPath: string
  branchName: string
}

export interface StatusFileRequest {
  repoPath: string
  paths: string[]
}

export type StatusFileDiffType = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

export interface StatusFileDiffRequest {
  repoPath: string
  path: string
  diffType: StatusFileDiffType
}

export interface StatusFileDiff {
  path: string
  diffType: StatusFileDiffType
  content: string
}

export interface CommitRequest {
  repoPath: string
  message: string
}

export interface RepositoryActionRequest {
  repoPath: string
  editorCommand?: string
}

export interface ScriptRunRequest {
  repoPath: string
  scriptName: string
  packageManager?: string
}

export interface ScriptRun {
  runId: string
  command: string
}

export interface ScriptOutput {
  runId: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
  exitCode?: number | null
  signal?: string | null
  done?: boolean
}

export interface ScriptTerminal {
  runId: string
  repoPath: string
  repoName: string
  scriptName: string
  command: string
  output: string
  isRunning: boolean
}

export interface PinnedScript {
  repoPath: string
  repoName: string
  scriptName: string
  command: string
  packageManager?: string
}

export interface RepositoryApi {
  list: () => Promise<RepositorySummary[]>
  chooseAndAdd: () => Promise<RepositorySummary[]>
  addByPath: (repoPath: string) => Promise<RepositorySummary[]>
  remove: (repoPath: string) => Promise<RepositorySummary[]>
  details: (repoPath: string) => Promise<RepositoryDetails>
  deleteBranch: (request: DeleteBranchRequest) => Promise<RepositoryDetails>
  syncBranch: (request: SyncBranchRequest) => Promise<RepositoryDetails>
  stageFiles: (request: StatusFileRequest) => Promise<RepositoryDetails>
  unstageFiles: (request: StatusFileRequest) => Promise<RepositoryDetails>
  diffFile: (request: StatusFileDiffRequest) => Promise<StatusFileDiff>
  commit: (request: CommitRequest) => Promise<RepositoryDetails>
  openInFileManager: (request: RepositoryActionRequest) => Promise<boolean>
  openInEditor: (request: RepositoryActionRequest) => Promise<boolean>
  openInTerminal: (request: RepositoryActionRequest) => Promise<boolean>
  startScript: (request: ScriptRunRequest) => Promise<ScriptRun>
  stopScript: (runId: string) => Promise<boolean>
  stopScripts: (runIds: string[]) => void
  onScriptOutput: (listener: (output: ScriptOutput) => void) => () => void
  onWindowFocus: (listener: () => void) => () => void
}
