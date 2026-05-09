/// <reference types="vite/client" />

import type { DesktopApi, RepositoryApi } from './repositories'
import type { AppStateApi } from './app-state'
import type { AppUpdatesApi } from './updates'

declare global {
  interface Window {
    appState: AppStateApi
    desktop: DesktopApi
    updates: AppUpdatesApi
    repositories: RepositoryApi
  }
}

export {}
