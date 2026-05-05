import * as electron from 'electron'
import type { DesktopApi, RepositoryApi } from '../src/repositories'

const { contextBridge, ipcRenderer } = electron

const repositories: RepositoryApi = {
  list: () => ipcRenderer.invoke('repositories:list'),
  chooseAndAdd: () => ipcRenderer.invoke('repositories:choose-and-add'),
  addByPath: (repoPath: string) => ipcRenderer.invoke('repositories:add-by-path', repoPath),
  remove: (repoPath: string) => ipcRenderer.invoke('repositories:remove', repoPath),
  details: (repoPath: string) => ipcRenderer.invoke('repositories:details', repoPath),
  checkoutBranch: (request) => ipcRenderer.invoke('repositories:checkout-branch', request),
  checkoutRemoteBranch: (request) => ipcRenderer.invoke('repositories:checkout-remote-branch', request),
  deleteBranch: (request) => ipcRenderer.invoke('repositories:delete-branch', request),
  syncBranch: (request) => ipcRenderer.invoke('repositories:sync-branch', request),
  stageFiles: (request) => ipcRenderer.invoke('repositories:stage-files', request),
  unstageFiles: (request) => ipcRenderer.invoke('repositories:unstage-files', request),
  diffFile: (request) => ipcRenderer.invoke('repositories:diff-file', request),
  commit: (request) => ipcRenderer.invoke('repositories:commit', request),
  openInFileManager: (request) => ipcRenderer.invoke('repositories:open-in-file-manager', request),
  openInEditor: (request) => ipcRenderer.invoke('repositories:open-in-editor', request),
  openInTerminal: (request) => ipcRenderer.invoke('repositories:open-in-terminal', request),
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

contextBridge.exposeInMainWorld('repositories', repositories)
contextBridge.exposeInMainWorld('desktop', desktop)
