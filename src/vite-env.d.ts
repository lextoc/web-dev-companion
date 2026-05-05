/// <reference types="vite/client" />

import type { DesktopApi, RepositoryApi } from './repositories'

declare global {
  interface Window {
    desktop: DesktopApi
    repositories: RepositoryApi
  }
}

export {}
