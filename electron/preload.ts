import * as electron from 'electron'
import type { RepositoryApi } from '../src/repositories'

const { contextBridge, ipcRenderer } = electron

const repositories: RepositoryApi = {
  list: () => ipcRenderer.invoke('repositories:list'),
  chooseAndAdd: () => ipcRenderer.invoke('repositories:choose-and-add'),
  addByPath: (repoPath: string) => ipcRenderer.invoke('repositories:add-by-path', repoPath),
  remove: (repoPath: string) => ipcRenderer.invoke('repositories:remove', repoPath),
  details: (repoPath: string) => ipcRenderer.invoke('repositories:details', repoPath),
  deleteBranch: (request) => ipcRenderer.invoke('repositories:delete-branch', request),
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
