import * as electron from 'electron'
import type { AppStateApi } from '../src/app-state'
import type { DesktopApi, RepositoryApi } from '../src/repositories'
import type { AppUpdatesApi } from '../src/updates'

const { contextBridge, ipcRenderer } = electron

const appState: AppStateApi = {
  read: () => ipcRenderer.invoke('app-state:read'),
  saveSettings: (settings) => ipcRenderer.invoke('app-state:save-settings', settings),
  savePinnedRepositoryPaths: (repoPaths) => ipcRenderer.invoke('app-state:save-pinned-repository-paths', repoPaths),
  savePinnedScripts: (scripts) => ipcRenderer.invoke('app-state:save-pinned-scripts', scripts),
  saveRecentCommandIds: (commandIds) => ipcRenderer.invoke('app-state:save-recent-command-ids', commandIds),
  saveRepositoryBranchLinks: (links) => ipcRenderer.invoke('app-state:save-repository-branch-links', links),
}

const repositories: RepositoryApi = {
  list: () => ipcRenderer.invoke('repositories:list'),
  chooseAndAdd: () => ipcRenderer.invoke('repositories:choose-and-add'),
  addByPath: (repoPath: string) => ipcRenderer.invoke('repositories:add-by-path', repoPath),
  remove: (repoPath: string) => ipcRenderer.invoke('repositories:remove', repoPath),
  scanLocalRepositories: () => ipcRenderer.invoke('repositories:scan-local-repositories'),
  listGitHubRepositories: () => ipcRenderer.invoke('repositories:list-github-repositories'),
  cloneGitHubRepository: (nameWithOwner: string) =>
    ipcRenderer.invoke('repositories:clone-github-repository', nameWithOwner),
  details: (repoPath: string) => ipcRenderer.invoke('repositories:details', repoPath),
  checkoutBranch: (request) => ipcRenderer.invoke('repositories:checkout-branch', request),
  checkoutSubmoduleBranch: (request) => ipcRenderer.invoke('repositories:checkout-submodule-branch', request),
  checkoutRemoteBranch: (request) => ipcRenderer.invoke('repositories:checkout-remote-branch', request),
  deleteBranch: (request) => ipcRenderer.invoke('repositories:delete-branch', request),
  deleteSubmoduleBranch: (request) => ipcRenderer.invoke('repositories:delete-submodule-branch', request),
  mergeBranch: (request) => ipcRenderer.invoke('repositories:merge-branch', request),
  mergeLinkedSubmoduleBranch: (request) => ipcRenderer.invoke('repositories:merge-linked-submodule-branch', request),
  syncBranch: (request) => ipcRenderer.invoke('repositories:sync-branch', request),
  syncSubmoduleBranch: (request) => ipcRenderer.invoke('repositories:sync-submodule-branch', request),
  stageFiles: (request) => ipcRenderer.invoke('repositories:stage-files', request),
  unstageFiles: (request) => ipcRenderer.invoke('repositories:unstage-files', request),
  resetTrackedChanges: (request) => ipcRenderer.invoke('repositories:reset-tracked-changes', request),
  diffFile: (request) => ipcRenderer.invoke('repositories:diff-file', request),
  commitDetails: (request) => ipcRenderer.invoke('repositories:commit-details', request),
  commit: (request) => ipcRenderer.invoke('repositories:commit', request),
  openCommitInBrowser: (request) => ipcRenderer.invoke('repositories:open-commit-in-browser', request),
  openInFileManager: (request) => ipcRenderer.invoke('repositories:open-in-file-manager', request),
  openInEditor: (request) => ipcRenderer.invoke('repositories:open-in-editor', request),
  openInTerminal: (request) => ipcRenderer.invoke('repositories:open-in-terminal', request),
  health: (repoPath: string) => ipcRenderer.invoke('repositories:health', repoPath),
  checkOutdatedDependencies: (repoPath: string) =>
    ipcRenderer.invoke('repositories:check-outdated-dependencies', repoPath),
  startScript: (request) => ipcRenderer.invoke('repositories:start-script', request),
  stopScript: (runId: string) => ipcRenderer.invoke('repositories:stop-script', runId),
  stopScripts: (runIds: string[]) => ipcRenderer.send('repositories:stop-scripts', runIds),
  onScriptOutput: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, output: Parameters<typeof listener>[0]) => {
      listener(output)
    }

    ipcRenderer.on('repositories:script-output', wrappedListener)

    return () => {
      ipcRenderer.off('repositories:script-output', wrappedListener)
    }
  },
  onGitCommand: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, entry: Parameters<typeof listener>[0]) => {
      listener(entry)
    }

    ipcRenderer.on('repositories:git-command', wrappedListener)

    return () => {
      ipcRenderer.off('repositories:git-command', wrappedListener)
    }
  },
  onWindowFocus: (listener) => {
    const wrappedListener = () => {
      listener()
    }

    ipcRenderer.on('repositories:window-focus', wrappedListener)

    return () => {
      ipcRenderer.off('repositories:window-focus', wrappedListener)
    }
  },
}

const desktop: DesktopApi = {
  notify: (request) => ipcRenderer.invoke('desktop:notify', request),
  setMenuState: (state) => ipcRenderer.invoke('desktop:set-menu-state', state),
  onMenuCommand: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, command: Parameters<typeof listener>[0]) => {
      listener(command)
    }

    ipcRenderer.on('desktop:menu-command', wrappedListener)

    return () => {
      ipcRenderer.off('desktop:menu-command', wrappedListener)
    }
  },
}

const updates: AppUpdatesApi = {
  getState: () => ipcRenderer.invoke('updates:get-state'),
  check: () => ipcRenderer.invoke('updates:check'),
  download: () => ipcRenderer.invoke('updates:download'),
  install: () => ipcRenderer.invoke('updates:install'),
  onStateChange: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => {
      listener(state)
    }

    ipcRenderer.on('updates:state-change', wrappedListener)

    return () => {
      ipcRenderer.off('updates:state-change', wrappedListener)
    }
  },
}

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

contextBridge.exposeInMainWorld('appState', appState)
contextBridge.exposeInMainWorld('repositories', repositories)
contextBridge.exposeInMainWorld('desktop', desktop)
contextBridge.exposeInMainWorld('updates', updates)
