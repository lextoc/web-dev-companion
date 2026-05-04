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

export interface RepositoryApi {
  list: () => Promise<RepositorySummary[]>
  chooseAndAdd: () => Promise<RepositorySummary[]>
  addByPath: (repoPath: string) => Promise<RepositorySummary[]>
  remove: (repoPath: string) => Promise<RepositorySummary[]>
  details: (repoPath: string) => Promise<RepositoryDetails>
  deleteBranch: (request: DeleteBranchRequest) => Promise<RepositoryDetails>
  startScript: (request: ScriptRunRequest) => Promise<ScriptRun>
  stopScript: (runId: string) => Promise<boolean>
  stopScripts: (runIds: string[]) => void
  onScriptOutput: (listener: (output: ScriptOutput) => void) => () => void
}
