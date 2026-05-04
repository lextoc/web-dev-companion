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

export interface RepositoryDetails extends RepositorySummary {
  gitLog: string
  gitStatus: string
  remotes: string
  npmScripts: Record<string, string>
  packageManager?: string
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

export interface RepositoryApi {
  list: () => Promise<RepositorySummary[]>
  chooseAndAdd: () => Promise<RepositorySummary[]>
  addByPath: (repoPath: string) => Promise<RepositorySummary[]>
  remove: (repoPath: string) => Promise<RepositorySummary[]>
  details: (repoPath: string) => Promise<RepositoryDetails>
  startScript: (request: ScriptRunRequest) => Promise<ScriptRun>
  stopScript: (runId: string) => Promise<boolean>
  stopScripts: (runIds: string[]) => void
  onScriptOutput: (listener: (output: ScriptOutput) => void) => () => void
}
