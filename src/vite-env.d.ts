/// <reference types="vite/client" />

import type { RepositoryApi } from './repositories'

declare global {
  interface Window {
    repositories: RepositoryApi
  }
}

export {}
