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

export interface CommitChangedFile {
  path: string
  originalPath?: string
  status: string
  additions?: number
  deletions?: number
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

export interface GitRemoteBranchEntry {
  name: string
  remote: string
  localName: string
  hasLocalBranch: boolean
}

export interface RepositoryDetails extends RepositorySummary {
  gitLog: GitLogEntry[]
  gitStatus: GitStatusSummary
  gitBranches: GitBranchEntry[]
  gitRemoteBranches: GitRemoteBranchEntry[]
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

export interface SyncBranchResult {
  details: RepositoryDetails
  pushed: boolean
}

export interface CheckoutBranchRequest {
  repoPath: string
  branchName: string
}

export interface CheckoutRemoteBranchRequest {
  repoPath: string
  remoteBranchName: string
  localBranchName?: string
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

export interface CommitDetailsRequest {
  repoPath: string
  hash: string
}

export interface CommitDetails extends GitLogEntry {
  fullHash: string
  body: string
  files: CommitChangedFile[]
  diff: string
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

export interface GitCommandLogEntry {
  id: string
  command: string
  repoPath: string
  startedAt: string
  durationMs: number
  ok: boolean
  error?: string
}

export interface ScriptTerminal {
  runId: string
  repoPath: string
  repoName: string
  scriptName: string
  command: string
  output: string
  isRunning: boolean
  startedAt: number
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
  checkoutBranch: (request: CheckoutBranchRequest) => Promise<RepositoryDetails>
  checkoutRemoteBranch: (request: CheckoutRemoteBranchRequest) => Promise<RepositoryDetails>
  deleteBranch: (request: DeleteBranchRequest) => Promise<RepositoryDetails>
  syncBranch: (request: SyncBranchRequest) => Promise<SyncBranchResult>
  stageFiles: (request: StatusFileRequest) => Promise<RepositoryDetails>
  unstageFiles: (request: StatusFileRequest) => Promise<RepositoryDetails>
  diffFile: (request: StatusFileDiffRequest) => Promise<StatusFileDiff>
  commitDetails: (request: CommitDetailsRequest) => Promise<CommitDetails>
  commit: (request: CommitRequest) => Promise<RepositoryDetails>
  openInFileManager: (request: RepositoryActionRequest) => Promise<boolean>
  openInEditor: (request: RepositoryActionRequest) => Promise<boolean>
  openInTerminal: (request: RepositoryActionRequest) => Promise<boolean>
  startScript: (request: ScriptRunRequest) => Promise<ScriptRun>
  stopScript: (runId: string) => Promise<boolean>
  stopScripts: (runIds: string[]) => void
  onScriptOutput: (listener: (output: ScriptOutput) => void) => () => void
  onGitCommand: (listener: (entry: GitCommandLogEntry) => void) => () => void
  onWindowFocus: (listener: () => void) => () => void
}

export type DesktopMenuCommand =
  | 'add-repository'
  | 'back'
  | 'open-in-editor'
  | 'open-in-file-manager'
  | 'open-in-terminal'
  | 'refresh'
  | 'settings'
  | 'stop-scripts'

export interface DesktopNotificationRequest {
  title: string
  body: string
}

export interface DesktopApi {
  notify: (request: DesktopNotificationRequest) => Promise<boolean>
  onMenuCommand: (listener: (command: DesktopMenuCommand) => void) => () => void
}
