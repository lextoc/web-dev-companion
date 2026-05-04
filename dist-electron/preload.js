"use strict";
const electron = require("electron");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const electron__namespace = /* @__PURE__ */ _interopNamespaceDefault(electron);
const { contextBridge, ipcRenderer } = electron__namespace;
const repositories = {
  list: () => ipcRenderer.invoke("repositories:list"),
  chooseAndAdd: () => ipcRenderer.invoke("repositories:choose-and-add"),
  addByPath: (repoPath) => ipcRenderer.invoke("repositories:add-by-path", repoPath),
  remove: (repoPath) => ipcRenderer.invoke("repositories:remove", repoPath),
  details: (repoPath) => ipcRenderer.invoke("repositories:details", repoPath),
  deleteBranch: (request) => ipcRenderer.invoke("repositories:delete-branch", request),
  syncBranch: (request) => ipcRenderer.invoke("repositories:sync-branch", request),
  startScript: (request) => ipcRenderer.invoke("repositories:start-script", request),
  stopScript: (runId) => ipcRenderer.invoke("repositories:stop-script", runId),
  stopScripts: (runIds) => ipcRenderer.send("repositories:stop-scripts", runIds),
  onScriptOutput: (listener) => {
    const wrappedListener = (_event, output) => {
      listener(output);
    };
    ipcRenderer.on("repositories:script-output", wrappedListener);
    return () => {
      ipcRenderer.off("repositories:script-output", wrappedListener);
    };
  }
};
contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return ipcRenderer.off(channel, ...omit);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return ipcRenderer.invoke(channel, ...omit);
  }
  // You can expose other APTs you need here.
  // ...
});
contextBridge.exposeInMainWorld("repositories", repositories);
