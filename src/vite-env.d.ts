/// <reference types="vite/client" />

import type { DesktopApi, RepositoryApi } from './repositories'
import type { AppStateApi } from './app-state'

declare global {
  interface Window {
    appState: AppStateApi
    desktop: DesktopApi
    repositories: RepositoryApi
  }
}

export {}
