import type { PinnedScript } from './repositories'
import type { AppSettings } from './settings'

export interface PersistedAppState {
  settings: AppSettings
  pinnedRepositoryPaths: string[]
  pinnedScripts: PinnedScript[]
  recentCommandIds: string[]
}

export interface AppStateApi {
  read: () => Promise<PersistedAppState>
  saveSettings: (settings: AppSettings) => Promise<AppSettings>
  savePinnedRepositoryPaths: (repoPaths: string[]) => Promise<string[]>
  savePinnedScripts: (scripts: PinnedScript[]) => Promise<PinnedScript[]>
  saveRecentCommandIds: (commandIds: string[]) => Promise<string[]>
}
