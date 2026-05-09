export interface RepositorySummary {
  path: string
  name: string
  branch: string
  lastCommit: string
  dirty: boolean
  taskCount: number
  ecosystems: ProjectTaskSource[]
  remote?: string
  error?: string
}

export interface GitHubRepositorySummary {
  name: string
  nameWithOwner: string
  description?: string
  url: string
  isPrivate: boolean
  isFork: boolean
  updatedAt?: string
  primaryLanguage?: string
}

export type ProjectTaskSource = 'node' | 'gradle' | 'maven' | 'rails' | 'rake'

export interface ProjectTask {
  id: string
  name: string
  command: string
  source: ProjectTaskSource
  cwd?: string
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
  mergeCommitMessage?: string
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

export interface GitSubmoduleBranchEntry {
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

export interface GitSubmoduleEntry {
  name: string
  path: string
  branch: string
  dirty: boolean
  branches: GitSubmoduleBranchEntry[]
}

export interface RepositoryDetails extends RepositorySummary {
  gitLog: GitLogEntry[]
  gitStatus: GitStatusSummary
  gitBranches: GitBranchEntry[]
  gitRemoteBranches: GitRemoteBranchEntry[]
  gitSubmodules: GitSubmoduleEntry[]
  remotes: string
  projectTasks: ProjectTask[]
  packageManager?: string
}

export type ProjectHealthStatus = 'ok' | 'warning' | 'error' | 'unknown'

export type ProjectDependencyStatus = 'idle' | 'ok' | 'outdated' | 'failed' | 'skipped'

export type ProjectScriptCheckStatus = 'idle' | 'passed' | 'failed' | 'skipped' | 'timed-out'

export interface ProjectHealthMessage {
  level: Exclude<ProjectHealthStatus, 'ok' | 'unknown'>
  text: string
}

export interface ProjectPackageHealth {
  detected?: string
  declared?: string
  lockfiles: string[]
  status: ProjectHealthStatus
  messages: ProjectHealthMessage[]
}

export interface ProjectNodeHealth {
  current?: string
  configured?: string
  engineRange?: string
  status: ProjectHealthStatus
  messages: ProjectHealthMessage[]
}

export interface ProjectJavaHealth {
  current?: string
  compiler?: string
  compilerMajor?: number
  configured?: string
  requiredRelease?: string
  requiredMajor?: number
  javaHome?: string
  maven?: string
  mavenWrapperPresent: boolean
  gradleWrapperPresent: boolean
  status: ProjectHealthStatus
  messages: ProjectHealthMessage[]
}

export interface ProjectInstallHealth {
  installed: boolean
  status: ProjectHealthStatus
  messages: ProjectHealthMessage[]
}

export interface ProjectLockfileHealth {
  present: boolean
  dirty: boolean
  stale: boolean
  status: ProjectHealthStatus
  messages: ProjectHealthMessage[]
}

export interface ProjectOutdatedDependency {
  name: string
  current?: string
  wanted?: string
  latest?: string
  type?: string
}

export interface ProjectDependencyHealth {
  status: ProjectDependencyStatus
  outdatedCount?: number
  outdated?: ProjectOutdatedDependency[]
  checkedAt?: string
  error?: string
}

export interface ProjectScriptCheck {
  name: string
  command?: string
  present: boolean
  status: ProjectScriptCheckStatus
  durationMs?: number
  exitCode?: number | null
  output?: string
  error?: string
}

export interface ProjectHealth {
  repoPath: string
  checkedAt: string
  packageJsonPresent: boolean
  packageManager: ProjectPackageHealth
  node: ProjectNodeHealth
  java: ProjectJavaHealth
  install: ProjectInstallHealth
  lockfile: ProjectLockfileHealth
  dependencies: ProjectDependencyHealth
  scripts: ProjectScriptCheck[]
}

export interface DeleteBranchRequest {
  repoPath: string
  branchName: string
}

export interface DeleteSubmoduleBranchRequest {
  repoPath: string
  submodulePath: string
  branchName: string
}

export interface CheckoutSubmoduleBranchRequest {
  repoPath: string
  submodulePath: string
  branchName: string
}

export interface SyncBranchRequest {
  repoPath: string
  branchName: string
}

export interface SyncSubmoduleBranchRequest {
  repoPath: string
  submodulePath: string
  branchName: string
}

export interface SyncBranchResult {
  details: RepositoryDetails
  pushed: boolean
}

export interface LinkedSubmoduleBranchMergeRoute {
  submodulePath: string
  sourceSubmoduleBranch: string
  targetSubmoduleBranch: string
}

export interface MergeLinkedSubmoduleBranchRequest {
  repoPath: string
  sourceParentBranch: string
  targetParentBranch: string
  routes: LinkedSubmoduleBranchMergeRoute[]
}

export interface MergeBranchRequest {
  repoPath: string
  sourceBranch: string
  targetBranch: string
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

export interface ResetTrackedChangesRequest {
  repoPath: string
  paths?: string[]
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

export interface OpenCommitInBrowserRequest {
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
  taskId: string
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
  taskId: string
  taskName: string
  source: ProjectTaskSource
  command: string
  output: string
  isRunning: boolean
  startedAt: number
  exitCode?: number | null
  signal?: string | null
}

export interface PinnedScript {
  repoPath: string
  repoName: string
  taskId: string
  taskName: string
  command: string
  source: ProjectTaskSource
  cwd?: string
}

export interface RepositoryApi {
  list: () => Promise<RepositorySummary[]>
  chooseAndAdd: () => Promise<RepositorySummary[]>
  addByPath: (repoPath: string) => Promise<RepositorySummary[]>
  remove: (repoPath: string) => Promise<RepositorySummary[]>
  scanLocalRepositories: () => Promise<RepositorySummary[]>
  listGitHubRepositories: () => Promise<GitHubRepositorySummary[]>
  cloneGitHubRepository: (nameWithOwner: string) => Promise<RepositorySummary[]>
  details: (repoPath: string) => Promise<RepositoryDetails>
  checkoutBranch: (request: CheckoutBranchRequest) => Promise<RepositoryDetails>
  checkoutSubmoduleBranch: (request: CheckoutSubmoduleBranchRequest) => Promise<RepositoryDetails>
  checkoutRemoteBranch: (request: CheckoutRemoteBranchRequest) => Promise<RepositoryDetails>
  deleteBranch: (request: DeleteBranchRequest) => Promise<RepositoryDetails>
  deleteSubmoduleBranch: (request: DeleteSubmoduleBranchRequest) => Promise<RepositoryDetails>
  mergeBranch: (request: MergeBranchRequest) => Promise<RepositoryDetails>
  mergeLinkedSubmoduleBranch: (request: MergeLinkedSubmoduleBranchRequest) => Promise<RepositoryDetails>
  syncBranch: (request: SyncBranchRequest) => Promise<SyncBranchResult>
  syncSubmoduleBranch: (request: SyncSubmoduleBranchRequest) => Promise<SyncBranchResult>
  stageFiles: (request: StatusFileRequest) => Promise<RepositoryDetails>
  unstageFiles: (request: StatusFileRequest) => Promise<RepositoryDetails>
  resetTrackedChanges: (request: ResetTrackedChangesRequest) => Promise<RepositoryDetails>
  diffFile: (request: StatusFileDiffRequest) => Promise<StatusFileDiff>
  commitDetails: (request: CommitDetailsRequest) => Promise<CommitDetails>
  commit: (request: CommitRequest) => Promise<RepositoryDetails>
  openCommitInBrowser: (request: OpenCommitInBrowserRequest) => Promise<boolean>
  openInFileManager: (request: RepositoryActionRequest) => Promise<boolean>
  openInEditor: (request: RepositoryActionRequest) => Promise<boolean>
  openInTerminal: (request: RepositoryActionRequest) => Promise<boolean>
  health: (repoPath: string) => Promise<ProjectHealth>
  checkOutdatedDependencies: (repoPath: string) => Promise<ProjectDependencyHealth>
  startScript: (request: ScriptRunRequest) => Promise<ScriptRun>
  stopScript: (runId: string) => Promise<boolean>
  stopScripts: (runIds: string[]) => void
  onScriptOutput: (listener: (output: ScriptOutput) => void) => () => void
  onGitCommand: (listener: (entry: GitCommandLogEntry) => void) => () => void
  onWindowFocus: (listener: () => void) => () => void
}

export type DesktopMenuCommand =
  | 'add-repository'
  | 'check-for-updates'
  | 'dashboard'
  | 'keyboard-shortcuts'
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

export interface DesktopMenuState {
  hasRepositoryDetail: boolean
  hasRunningScripts: boolean
}

export interface DesktopApi {
  notify: (request: DesktopNotificationRequest) => Promise<boolean>
  setMenuState: (state: DesktopMenuState) => Promise<DesktopMenuState>
  onMenuCommand: (listener: (command: DesktopMenuCommand) => void) => () => void
}
