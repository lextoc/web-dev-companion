"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const node_child_process = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const node_util = require("node:util");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const currentDirectory = __dirname;
const execFileAsync = node_util.promisify(node_child_process.execFile);
const repositoriesFileName = "repositories.json";
const runningScripts = /* @__PURE__ */ new Map();
const pendingScriptRuns = /* @__PURE__ */ new Set();
process.env.APP_ROOT = path.join(currentDirectory, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function repositoriesFilePath() {
  return path.join(app.getPath("userData"), repositoriesFileName);
}
async function readRepositoryPaths() {
  try {
    const content = await fs.readFile(repositoriesFilePath(), "utf8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((repoPath) => typeof repoPath === "string");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
async function writeRepositoryPaths(repoPaths) {
  await fs.mkdir(path.dirname(repositoriesFilePath()), { recursive: true });
  await fs.writeFile(repositoriesFilePath(), JSON.stringify(repoPaths, null, 2));
}
async function normalizeRepositoryPath(repoPath) {
  if (!repoPath.trim()) {
    throw new Error("Enter a repository path.");
  }
  const resolvedPath = path.resolve(repoPath.trim());
  const stats = await fs.stat(resolvedPath);
  if (!stats.isDirectory()) {
    throw new Error("Repository path must be a folder.");
  }
  const topLevelPath = await runGit(resolvedPath, ["rev-parse", "--show-toplevel"]);
  return path.resolve(topLevelPath || resolvedPath);
}
async function runGit(repoPath, args, timeout = 5e3) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoPath,
      encoding: "utf8",
      timeout
    });
    return stdout.trim();
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message);
    }
    throw error;
  }
}
async function tryRunGit(repoPath, args) {
  try {
    return await runGit(repoPath, args);
  } catch {
    return "";
  }
}
async function readPackageScripts(repoPath) {
  try {
    const packageJson = await fs.readFile(path.join(repoPath, "package.json"), "utf8");
    const parsed = JSON.parse(packageJson);
    const scripts = parsed == null ? void 0 : parsed.scripts;
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(scripts).filter((entry) => {
        const [scriptName, command] = entry;
        return typeof scriptName === "string" && typeof command === "string";
      })
    );
  } catch {
    return {};
  }
}
async function detectPackageManager(repoPath) {
  const lockFiles = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
    ["bun.lockb", "bun"]
  ];
  for (const [lockFile, packageManager] of lockFiles) {
    try {
      await fs.access(path.join(repoPath, lockFile));
      return packageManager;
    } catch {
      continue;
    }
  }
  return void 0;
}
function commandForPackageManager(packageManager) {
  return packageManager || "npm";
}
function sendScriptOutput(output) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return;
  }
  try {
    win.webContents.send("repositories:script-output", output);
  } catch {
  }
}
function terminateScriptProcess(child) {
  if (process.platform === "win32") {
    child.kill("SIGTERM");
    return;
  }
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      child.kill("SIGTERM");
    }
  }
}
function launchScript(runId, repoPath, packageManager, scriptName) {
  if (!pendingScriptRuns.has(runId)) {
    return;
  }
  pendingScriptRuns.delete(runId);
  const child = node_child_process.spawn(packageManager, ["run", scriptName], {
    cwd: repoPath,
    detached: process.platform !== "win32",
    env: process.env,
    shell: true
  });
  runningScripts.set(runId, child);
  child.stdout.on("data", (chunk) => {
    sendScriptOutput({
      runId,
      stream: "stdout",
      text: chunk.toString()
    });
  });
  child.stderr.on("data", (chunk) => {
    sendScriptOutput({
      runId,
      stream: "stderr",
      text: chunk.toString()
    });
  });
  child.on("error", (error) => {
    sendScriptOutput({
      runId,
      stream: "system",
      text: `${error.message}
`,
      done: true
    });
    runningScripts.delete(runId);
  });
  child.on("close", (exitCode, signal) => {
    sendScriptOutput({
      runId,
      stream: "system",
      text: `
Process ${signal ? `stopped with ${signal}` : `exited with code ${exitCode ?? 0}`}.
`,
      exitCode,
      signal,
      done: true
    });
    runningScripts.delete(runId);
  });
}
async function startScript(request) {
  const repoPath = await normalizeRepositoryPath(request.repoPath);
  const npmScripts = await readPackageScripts(repoPath);
  if (!npmScripts[request.scriptName]) {
    throw new Error(`Script "${request.scriptName}" was not found.`);
  }
  const packageManager = commandForPackageManager(request.packageManager || await detectPackageManager(repoPath));
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const command = `${packageManager} run ${request.scriptName}`;
  pendingScriptRuns.add(runId);
  setTimeout(() => {
    launchScript(runId, repoPath, packageManager, request.scriptName);
  }, 0);
  return {
    runId,
    command
  };
}
function stopScript(runId) {
  if (pendingScriptRuns.delete(runId)) {
    sendScriptOutput({
      runId,
      stream: "system",
      text: "\nProcess stopped before it started.\n",
      done: true
    });
    return true;
  }
  const child = runningScripts.get(runId);
  if (!child) {
    return false;
  }
  terminateScriptProcess(child);
  return true;
}
function stopAllScripts() {
  for (const runId of pendingScriptRuns) {
    stopScript(runId);
  }
  for (const child of runningScripts.values()) {
    terminateScriptProcess(child);
  }
  runningScripts.clear();
}
async function readRepositorySummary(repoPath) {
  const name = path.basename(repoPath);
  try {
    const [branch, lastCommit, status, remote, npmScripts] = await Promise.all([
      tryRunGit(repoPath, ["branch", "--show-current"]),
      tryRunGit(repoPath, ["log", "-1", "--pretty=format:%h %s (%cr)"]),
      tryRunGit(repoPath, ["status", "--short"]),
      tryRunGit(repoPath, ["remote", "get-url", "origin"]),
      readPackageScripts(repoPath)
    ]);
    return {
      path: repoPath,
      name,
      branch: branch || "detached",
      lastCommit: lastCommit || "No commits found",
      dirty: status.length > 0,
      npmScriptCount: Object.keys(npmScripts).length,
      remote: remote || void 0
    };
  } catch (error) {
    return {
      path: repoPath,
      name,
      branch: "unknown",
      lastCommit: "Unavailable",
      dirty: false,
      npmScriptCount: 0,
      error: error instanceof Error ? error.message : "Could not read repository."
    };
  }
}
async function readGitLogEntries(repoPath) {
  const fieldSeparator = "";
  const recordSeparator = "";
  const output = await tryRunGit(repoPath, [
    "log",
    "-n",
    "30",
    `--pretty=format:%h%x1f%cr%x1f%cI%x1f%an%x1f%ae%x1f%s%x1e`
  ]);
  if (!output) {
    return [];
  }
  return output.split(recordSeparator).map((record) => record.trim()).filter(Boolean).map((record) => {
    const [hash = "", time = "", dateTime = "", authorName = "", authorEmail = "", message = ""] = record.split(fieldSeparator);
    return {
      hash,
      time,
      dateTime,
      authorName,
      authorEmail,
      message
    };
  });
}
const statusLabels = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  U: "Unmerged",
  "?": "Untracked"
};
function statusLabel(statusCode) {
  return statusLabels[statusCode] || "Changed";
}
function parseStatusPath(rawPath) {
  const renameSeparator = " -> ";
  if (!rawPath.includes(renameSeparator)) {
    return { path: rawPath };
  }
  const [originalPath, ...nextPathParts] = rawPath.split(renameSeparator);
  return {
    originalPath,
    path: nextPathParts.join(renameSeparator)
  };
}
function makeStatusEntry(index, workingTree, rawPath, labelCode) {
  return {
    ...parseStatusPath(rawPath),
    index,
    workingTree,
    label: statusLabel(labelCode)
  };
}
function isConflictStatus(index, workingTree) {
  return index === "U" || workingTree === "U" || index === "A" && workingTree === "A" || index === "D" && workingTree === "D";
}
function hasStagedOrUnstagedChanges(gitStatus) {
  return gitStatus.staged.length > 0 || gitStatus.unstaged.length > 0 || gitStatus.conflicted.length > 0;
}
async function isGitAncestor(repoPath, ancestor, descendant) {
  try {
    await runGit(repoPath, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}
async function readGitStatus(repoPath) {
  const rawStatus = await tryRunGit(repoPath, ["status", "--porcelain=v1", "--branch"]);
  const [branchLine = "", ...statusLines] = rawStatus.split("\n").filter(Boolean);
  const branch = branchLine.startsWith("## ") ? branchLine.slice(3) : branchLine || "unknown";
  const summary = {
    branch,
    clean: statusLines.length === 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    raw: rawStatus || "Working tree clean."
  };
  for (const statusLine of statusLines) {
    const index = statusLine[0] || " ";
    const workingTree = statusLine[1] || " ";
    const rawPath = statusLine.slice(3);
    if (index === "?" && workingTree === "?") {
      summary.untracked.push(makeStatusEntry(index, workingTree, rawPath, "?"));
      continue;
    }
    if (isConflictStatus(index, workingTree)) {
      summary.conflicted.push(makeStatusEntry(index, workingTree, rawPath, "U"));
      continue;
    }
    if (index !== " ") {
      summary.staged.push(makeStatusEntry(index, workingTree, rawPath, index));
    }
    if (workingTree !== " ") {
      summary.unstaged.push(makeStatusEntry(index, workingTree, rawPath, workingTree));
    }
  }
  return summary;
}
function parseTrackingStatus(trackingStatus) {
  const aheadMatch = trackingStatus.match(/ahead (\d+)/);
  const behindMatch = trackingStatus.match(/behind (\d+)/);
  return {
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
    remoteGone: trackingStatus === "gone"
  };
}
function branchDeleteReason(branch) {
  if (branch.current) {
    return "Current branch cannot be deleted.";
  }
  if (!branch.upstream) {
    return "No upstream remote branch is configured.";
  }
  if (branch.remoteGone) {
    return "Upstream remote branch is gone.";
  }
  if (branch.ahead > 0 || branch.behind > 0) {
    return "Branch is not in sync with its remote.";
  }
  return void 0;
}
async function readGitBranches(repoPath) {
  const fieldSeparator = "\0";
  const output = await tryRunGit(repoPath, [
    "for-each-ref",
    "refs/heads",
    `--format=%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(upstream:track,nobracket)`,
    "--sort=refname"
  ]);
  if (!output) {
    return [];
  }
  return output.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [head = "", name = "", upstream = "", trackingStatus = ""] = line.split(fieldSeparator);
    const { ahead, behind, remoteGone } = parseTrackingStatus(trackingStatus);
    const branch = {
      name,
      upstream: upstream || void 0,
      current: head === "*",
      ahead,
      behind,
      remoteGone
    };
    const deleteReason = branchDeleteReason(branch);
    return {
      ...branch,
      inSyncWithRemote: Boolean(branch.upstream) && !remoteGone && ahead === 0 && behind === 0,
      canDelete: !deleteReason,
      deleteReason
    };
  });
}
async function readRepositoryDetails(repoPath) {
  const normalizedPath = await normalizeRepositoryPath(repoPath);
  const [summary, gitLog, gitStatus, gitBranches, remotes, npmScripts, packageManager] = await Promise.all([
    readRepositorySummary(normalizedPath),
    readGitLogEntries(normalizedPath),
    readGitStatus(normalizedPath),
    readGitBranches(normalizedPath),
    tryRunGit(normalizedPath, ["remote", "-v"]),
    readPackageScripts(normalizedPath),
    detectPackageManager(normalizedPath)
  ]);
  return {
    ...summary,
    gitLog,
    gitStatus,
    gitBranches,
    remotes: remotes || "No git remotes configured.",
    npmScripts,
    packageManager
  };
}
async function deleteBranch(request) {
  const normalizedPath = await normalizeRepositoryPath(request.repoPath);
  const branchName = request.branchName.trim();
  if (!branchName) {
    throw new Error("Branch name is required.");
  }
  const branch = (await readGitBranches(normalizedPath)).find((entry) => entry.name === branchName);
  if (!branch) {
    throw new Error(`Branch "${branchName}" was not found.`);
  }
  if (!branch.canDelete) {
    throw new Error(branch.deleteReason || "Branch cannot be deleted.");
  }
  await runGit(normalizedPath, ["branch", "-D", "--", branchName]);
  return readRepositoryDetails(normalizedPath);
}
async function syncBranch(request) {
  const normalizedPath = await normalizeRepositoryPath(request.repoPath);
  const branchName = request.branchName.trim();
  if (!branchName) {
    throw new Error("Branch name is required.");
  }
  const [gitStatus, branches] = await Promise.all([readGitStatus(normalizedPath), readGitBranches(normalizedPath)]);
  if (hasStagedOrUnstagedChanges(gitStatus)) {
    throw new Error("Commit, stash, or discard staged and unstaged changes before syncing branches.");
  }
  const branch = branches.find((entry) => entry.name === branchName);
  if (!branch) {
    throw new Error(`Branch "${branchName}" was not found.`);
  }
  if (!branch.upstream) {
    throw new Error(`Branch "${branchName}" has no upstream remote branch.`);
  }
  if (branch.remoteGone) {
    throw new Error(`Branch "${branchName}" tracks a remote branch that is gone.`);
  }
  if (branch.current) {
    await runGit(normalizedPath, ["pull", "--ff-only"], 12e4);
    return readRepositoryDetails(normalizedPath);
  }
  const remoteName = await runGit(normalizedPath, ["config", "--get", `branch.${branchName}.remote`]);
  if (!remoteName || remoteName === ".") {
    throw new Error(`Branch "${branchName}" does not track a remote branch.`);
  }
  await runGit(normalizedPath, ["fetch", remoteName], 12e4);
  const branchRef = `refs/heads/${branchName}`;
  const localCommit = await runGit(normalizedPath, ["rev-parse", "--verify", branchRef]);
  const upstreamCommit = await runGit(normalizedPath, ["rev-parse", "--verify", `${branchName}@{upstream}`]);
  if (localCommit === upstreamCommit || await isGitAncestor(normalizedPath, upstreamCommit, localCommit)) {
    return readRepositoryDetails(normalizedPath);
  }
  if (!await isGitAncestor(normalizedPath, localCommit, upstreamCommit)) {
    throw new Error(`Branch "${branchName}" cannot be fast-forwarded from ${branch.upstream}.`);
  }
  await runGit(normalizedPath, ["update-ref", branchRef, upstreamCommit, localCommit], 12e4);
  return readRepositoryDetails(normalizedPath);
}
async function listRepositories() {
  const repoPaths = await readRepositoryPaths();
  return Promise.all(repoPaths.map(readRepositorySummary));
}
async function addRepository(repoPath) {
  const normalizedPath = await normalizeRepositoryPath(repoPath);
  const repoPaths = await readRepositoryPaths();
  const nextPaths = [normalizedPath, ...repoPaths.filter((savedPath) => savedPath !== normalizedPath)];
  await writeRepositoryPaths(nextPaths);
  return listRepositories();
}
function registerRepositoryHandlers() {
  ipcMain.handle("repositories:list", listRepositories);
  ipcMain.handle("repositories:add-by-path", (_event, repoPath) => addRepository(repoPath));
  ipcMain.handle("repositories:choose-and-add", async () => {
    const dialogOptions = {
      properties: ["openDirectory"],
      title: "Add repository"
    };
    const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || !result.filePaths[0]) {
      return listRepositories();
    }
    return addRepository(result.filePaths[0]);
  });
  ipcMain.handle("repositories:remove", async (_event, repoPath) => {
    const repoPaths = await readRepositoryPaths();
    await writeRepositoryPaths(repoPaths.filter((savedPath) => savedPath !== repoPath));
    return listRepositories();
  });
  ipcMain.handle("repositories:details", (_event, repoPath) => readRepositoryDetails(repoPath));
  ipcMain.handle("repositories:delete-branch", (_event, request) => deleteBranch(request));
  ipcMain.handle("repositories:sync-branch", (_event, request) => syncBranch(request));
  ipcMain.handle("repositories:start-script", (_event, request) => startScript(request));
  ipcMain.handle("repositories:stop-script", (_event, runId) => stopScript(runId));
  ipcMain.on("repositories:stop-scripts", (_event, runIds) => {
    for (const runId of runIds) {
      stopScript(runId);
    }
  });
}
function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 1e3,
    minWidth: 1180,
    minHeight: 720,
    title: "Web Dev Companion",
    icon: path.join(process.env.VITE_PUBLIC, "web-dev-companion.svg"),
    webPreferences: {
      preload: path.join(currentDirectory, "preload.js")
    }
  });
  win.maximize();
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
app.on("window-all-closed", () => {
  stopAllScripts();
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(() => {
  registerRepositoryHandlers();
  createWindow();
});
exports.MAIN_DIST = MAIN_DIST;
exports.RENDERER_DIST = RENDERER_DIST;
exports.VITE_DEV_SERVER_URL = VITE_DEV_SERVER_URL;
