import type { PinnedScript } from './repositories'
import type { AppSettings } from './settings'

export interface RepositoryBranchLink {
  repoPath: string
  parentBranch: string
  submodulePath: string
  submoduleBranch: string
  updatedAt: string
}

export interface PersistedAppState {
  settings: AppSettings
  pinnedRepositoryPaths: string[]
  pinnedScripts: PinnedScript[]
  recentCommandIds: string[]
  repositoryBranchLinks: RepositoryBranchLink[]
}

export interface AppStateApi {
  read: () => Promise<PersistedAppState>
  saveSettings: (settings: AppSettings) => Promise<AppSettings>
  savePinnedRepositoryPaths: (repoPaths: string[]) => Promise<string[]>
  savePinnedScripts: (scripts: PinnedScript[]) => Promise<PinnedScript[]>
  saveRecentCommandIds: (commandIds: string[]) => Promise<string[]>
  saveRepositoryBranchLinks: (links: RepositoryBranchLink[]) => Promise<RepositoryBranchLink[]>
}
