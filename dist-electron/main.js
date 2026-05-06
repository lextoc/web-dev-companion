"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const path = require("node:path");
const fs = require("node:fs/promises");
const node_child_process = require("node:child_process");
const node_util = require("node:util");
const os = require("node:os");
function childProcessEnv() {
  const homeDirectory = os.homedir();
  const pathEntries = [
    process.env.PATH,
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    path.join(homeDirectory, ".local", "bin"),
    path.join(homeDirectory, ".cargo", "bin"),
    path.join(homeDirectory, ".volta", "bin"),
    path.join(homeDirectory, ".asdf", "shims")
  ].filter((entry) => Boolean(entry));
  return {
    ...process.env,
    PATH: [...new Set(pathEntries.flatMap((entry) => entry.split(path.delimiter).filter(Boolean)))].join(
      path.delimiter
    )
  };
}
const execFileAsync = node_util.promisify(node_child_process.execFile);
async function runGit(repoPath, args, timeout = 5e3) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoPath,
      encoding: "utf8",
      env: childProcessEnv(),
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
async function readGitRemoteBranches(repoPath, localBranches) {
  const output = await tryRunGit(repoPath, [
    "for-each-ref",
    "refs/remotes",
    "--format=%(refname:short)",
    "--sort=refname"
  ]);
  const localBranchNames = new Set(localBranches.map((branch) => branch.name));
  if (!output) {
    return [];
  }
  return output.split("\n").map((line) => line.trim()).filter((name) => name && !name.endsWith("/HEAD")).map((name) => {
    const [remote, ...localNameParts] = name.split("/");
    const localName = localNameParts.join("/");
    return {
      name,
      remote,
      localName,
      hasLocalBranch: localBranchNames.has(localName)
    };
  });
}
const maxInlineFileDiffBytes = 5e5;
function launchDetached(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = node_child_process.spawn(command, args, {
      cwd,
      detached: true,
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
function editorCommand(requestedCommand) {
  const command = (requestedCommand == null ? void 0 : requestedCommand.trim()) || process.env.VISUAL || process.env.EDITOR || "code";
  if (command.includes("/") || command.includes("\\")) {
    return command;
  }
  return command;
}
async function openWindowsTerminal(normalizedPath) {
  try {
    await launchDetached("wt", ["-d", normalizedPath], normalizedPath);
    return;
  } catch {
    const commandPrompt = process.env.ComSpec || "cmd.exe";
    await launchDetached(
      commandPrompt,
      ["/d", "/c", "start", '""', commandPrompt, "/k", "cd", "/d", normalizedPath],
      normalizedPath
    );
  }
}
function createRepositoryService(repositoriesFilePath2, shell2) {
  async function readRepositoryPaths() {
    try {
      const content = await fs.readFile(repositoriesFilePath2(), "utf8");
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
    await fs.mkdir(path.dirname(repositoriesFilePath2()), { recursive: true });
    await fs.writeFile(repositoriesFilePath2(), JSON.stringify(repoPaths, null, 2));
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
    const gitRemoteBranches = await readGitRemoteBranches(normalizedPath, gitBranches);
    return {
      ...summary,
      gitLog,
      gitStatus,
      gitBranches,
      gitRemoteBranches,
      remotes: remotes || "No git remotes configured.",
      npmScripts,
      packageManager
    };
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
  async function removeRepository(repoPath) {
    const repoPaths = await readRepositoryPaths();
    await writeRepositoryPaths(repoPaths.filter((savedPath) => savedPath !== repoPath));
    return listRepositories();
  }
  async function openInFileManager(request) {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath);
    const errorMessage = await shell2.openPath(normalizedPath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return true;
  }
  async function openInEditor(request) {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath);
    await launchDetached(editorCommand(request.editorCommand), [normalizedPath], normalizedPath);
    return true;
  }
  async function openInTerminal(request) {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath);
    if (process.platform === "darwin") {
      await launchDetached("open", ["-a", "Terminal", normalizedPath], normalizedPath);
      return true;
    }
    if (process.platform === "win32") {
      await openWindowsTerminal(normalizedPath);
      return true;
    }
    await launchDetached(process.env.TERMINAL || "x-terminal-emulator", [], normalizedPath);
    return true;
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
  async function assertCleanWorkingTreeForCheckout(normalizedPath) {
    const gitStatus = await readGitStatus(normalizedPath);
    if (!gitStatus.clean) {
      throw new Error("Commit, stash, or discard working tree changes before switching branches.");
    }
  }
  async function checkoutBranch(request) {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath);
    const branchName = request.branchName.trim();
    if (!branchName) {
      throw new Error("Branch name is required.");
    }
    await assertCleanWorkingTreeForCheckout(normalizedPath);
    const branch = (await readGitBranches(normalizedPath)).find((entry) => entry.name === branchName);
    if (!branch) {
      throw new Error(`Branch "${branchName}" was not found.`);
    }
    if (!branch.current) {
      await runGit(normalizedPath, ["switch", "--", branchName], 12e4);
    }
    return readRepositoryDetails(normalizedPath);
  }
  async function checkoutRemoteBranch(request) {
    var _a;
    const normalizedPath = await normalizeRepositoryPath(request.repoPath);
    const remoteBranchName = request.remoteBranchName.trim();
    if (!remoteBranchName) {
      throw new Error("Remote branch name is required.");
    }
    await assertCleanWorkingTreeForCheckout(normalizedPath);
    const localBranches = await readGitBranches(normalizedPath);
    const remoteBranch = (await readGitRemoteBranches(normalizedPath, localBranches)).find((entry) => entry.name === remoteBranchName);
    if (!remoteBranch) {
      throw new Error(`Remote branch "${remoteBranchName}" was not found.`);
    }
    const localBranchName = ((_a = request.localBranchName) == null ? void 0 : _a.trim()) || remoteBranch.localName;
    if (!localBranchName) {
      throw new Error("Local branch name is required.");
    }
    if (localBranches.some((branch) => branch.name === localBranchName)) {
      throw new Error(`Local branch "${localBranchName}" already exists.`);
    }
    await runGit(normalizedPath, ["switch", "--track", "-c", localBranchName, remoteBranch.name], 12e4);
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
    const remoteName = await runGit(normalizedPath, ["config", "--get", `branch.${branchName}.remote`]);
    if (!remoteName || remoteName === ".") {
      throw new Error(`Branch "${branchName}" does not track a remote branch.`);
    }
    const upstreamMergeRef = await runGit(normalizedPath, ["config", "--get", `branch.${branchName}.merge`]);
    if (!upstreamMergeRef) {
      throw new Error(`Branch "${branchName}" does not track a remote branch.`);
    }
    await runGit(normalizedPath, ["fetch", remoteName], 12e4);
    const refreshedBranch = (await readGitBranches(normalizedPath)).find((entry) => entry.name === branchName);
    if (!refreshedBranch) {
      throw new Error(`Branch "${branchName}" was not found.`);
    }
    if (refreshedBranch.remoteGone) {
      throw new Error(`Branch "${branchName}" tracks a remote branch that is gone.`);
    }
    const branchRef = `refs/heads/${branchName}`;
    const localCommit = await runGit(normalizedPath, ["rev-parse", "--verify", branchRef]);
    const upstreamCommit = await runGit(normalizedPath, ["rev-parse", "--verify", `${branchName}@{upstream}`]);
    if (localCommit === upstreamCommit) {
      return readRepositoryDetails(normalizedPath);
    }
    if (await isGitAncestor(normalizedPath, localCommit, upstreamCommit)) {
      if (refreshedBranch.current) {
        await runGit(normalizedPath, ["merge", "--ff-only", `${branchName}@{upstream}`], 12e4);
        return readRepositoryDetails(normalizedPath);
      }
      await runGit(normalizedPath, ["update-ref", branchRef, upstreamCommit, localCommit], 12e4);
      return readRepositoryDetails(normalizedPath);
    }
    if (await isGitAncestor(normalizedPath, upstreamCommit, localCommit)) {
      await runGit(normalizedPath, ["push", remoteName, `${branchRef}:${upstreamMergeRef}`], 12e4);
      return readRepositoryDetails(normalizedPath);
    }
    throw new Error(`Branch "${branchName}" has both local and remote commits. Resolve it manually before syncing.`);
  }
  function normalizeStatusPaths(paths) {
    const normalizedPaths = [...new Set(paths.map((statusPath) => statusPath.trim()).filter(Boolean))];
    if (normalizedPaths.length === 0) {
      throw new Error("Choose at least one file.");
    }
    return normalizedPaths;
  }
  async function readUntrackedFileDiff(repoPath, statusPath) {
    const absoluteFilePath = path.resolve(repoPath, statusPath);
    const relativePath = path.relative(repoPath, absoluteFilePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error("File path must stay inside the repository.");
    }
    const stats = await fs.stat(absoluteFilePath);
    if (!stats.isFile()) {
      return `Untracked path is not a regular file: ${statusPath}`;
    }
    if (stats.size > maxInlineFileDiffBytes) {
      return `Untracked file is too large to preview (${Math.ceil(stats.size / 1024)} KB).`;
    }
    const content = await fs.readFile(absoluteFilePath, "utf8");
    return [
      `--- /dev/null`,
      `+++ b/${statusPath}`,
      "@@ untracked file @@",
      ...content.split("\n").map((line) => `+${line}`)
    ].join("\n");
  }
  async function diffFile(request) {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath);
    const [statusPath] = normalizeStatusPaths([request.path]);
    let content = "";
    if (request.diffType === "staged") {
      content = await tryRunGit(normalizedPath, ["diff", "--cached", "--no-ext-diff", "--", statusPath]);
    } else if (request.diffType === "untracked") {
      content = await readUntrackedFileDiff(normalizedPath, statusPath);
    } else {
      content = await tryRunGit(normalizedPath, ["diff", "--no-ext-diff", "--", statusPath]);
    }
    return {
      path: statusPath,
      diffType: request.diffType,
      content: content || "No diff output available for this file."
    };
  }
  async function stageFiles(request) {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath);
    const statusPaths = normalizeStatusPaths(request.paths);
    await runGit(normalizedPath, ["add", "--", ...statusPaths]);
    return readRepositoryDetails(normalizedPath);
  }
  async function unstageFiles(request) {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath);
    const statusPaths = normalizeStatusPaths(request.paths);
    await runGit(normalizedPath, ["restore", "--staged", "--", ...statusPaths]);
    return readRepositoryDetails(normalizedPath);
  }
  async function commit(request) {
    const normalizedPath = await normalizeRepositoryPath(request.repoPath);
    const message = request.message.trim();
    if (!message) {
      throw new Error("Commit message is required.");
    }
    const gitStatus = await readGitStatus(normalizedPath);
    if (gitStatus.conflicted.length > 0) {
      throw new Error("Resolve conflicts before committing.");
    }
    if (gitStatus.staged.length === 0) {
      throw new Error("Stage at least one file before committing.");
    }
    await runGit(normalizedPath, ["commit", "-m", message], 12e4);
    return readRepositoryDetails(normalizedPath);
  }
  return {
    addRepository,
    checkoutBranch,
    checkoutRemoteBranch,
    commit,
    deleteBranch,
    diffFile,
    listRepositories,
    openInEditor,
    openInFileManager,
    openInTerminal,
    readRepositoryDetails,
    removeRepository,
    stageFiles,
    syncBranch,
    unstageFiles
  };
}
function commandForPackageManager(packageManager) {
  return packageManager || "npm";
}
function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
function scriptCommand(packageManager, scriptName) {
  return `${shellQuote(packageManager)} run ${shellQuote(scriptName)}`;
}
function launchCommand(packageManager, scriptName) {
  if (process.platform === "win32") {
    return {
      command: packageManager,
      args: ["run", scriptName],
      shell: true
    };
  }
  if (process.platform === "darwin") {
    return {
      command: process.env.SHELL || "/bin/zsh",
      args: ["-ilc", scriptCommand(packageManager, scriptName)],
      shell: false
    };
  }
  return {
    command: process.env.SHELL || "/bin/sh",
    args: ["-lc", scriptCommand(packageManager, scriptName)],
    shell: false
  };
}
function createScriptRunner({ sendOutput }) {
  const runningScripts = /* @__PURE__ */ new Map();
  const pendingScriptRuns = /* @__PURE__ */ new Set();
  function terminateScriptProcess(child) {
    if (process.platform === "win32") {
      if (child.pid) {
        const killer = node_child_process.spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true
        });
        killer.once("error", () => {
          child.kill("SIGTERM");
        });
        return;
      }
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
    const launch = launchCommand(packageManager, scriptName);
    const child = node_child_process.spawn(launch.command, launch.args, {
      cwd: repoPath,
      detached: process.platform !== "win32",
      env: childProcessEnv(),
      shell: launch.shell,
      windowsHide: true
    });
    runningScripts.set(runId, child);
    child.stdout.on("data", (chunk) => {
      sendOutput({
        runId,
        stream: "stdout",
        text: chunk.toString()
      });
    });
    child.stderr.on("data", (chunk) => {
      sendOutput({
        runId,
        stream: "stderr",
        text: chunk.toString()
      });
    });
    child.on("error", (error) => {
      sendOutput({
        runId,
        stream: "system",
        text: `${error.message}
`,
        done: true
      });
      runningScripts.delete(runId);
    });
    child.on("close", (exitCode, signal) => {
      sendOutput({
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
      sendOutput({
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
  return {
    startScript,
    stopAllScripts,
    stopScript
  };
}
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell
} = require("electron");
const currentDirectory = __dirname;
const appName = "Web Dev Companion";
const repositoriesFileName = "repositories.json";
const refreshCommandThrottleMs = 1e3;
const windowBounds = {
  width: 1360,
  height: 820,
  minWidth: 1360,
  minHeight: 820,
  maxWidth: 1800,
  maxHeight: 1100
};
app.setName(appName);
process.env.APP_ROOT = path.join(currentDirectory, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
let lastRefreshCommandAt = 0;
function repositoriesFilePath() {
  return path.join(app.getPath("userData"), repositoriesFileName);
}
function appIconPath() {
  return path.join(process.env.VITE_PUBLIC, "web-dev-companion.png");
}
function configureAppIdentity() {
  if (process.platform === "darwin") {
    const appIcon = nativeImage.createFromPath(appIconPath());
    if (!appIcon.isEmpty()) {
      app.dock.setIcon(appIcon);
      app.setAboutPanelOptions({
        applicationName: appName,
        iconPath: appIconPath()
      });
    }
  }
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
function sendMenuCommand(command) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return;
  }
  win.webContents.send("desktop:menu-command", command);
}
function sendThrottledRefreshCommand() {
  const now = Date.now();
  if (now - lastRefreshCommandAt < refreshCommandThrottleMs) {
    return;
  }
  lastRefreshCommandAt = now;
  sendMenuCommand("refresh");
}
function isRepositoryRefreshShortcut(input) {
  return input.type === "keyDown" && input.key.toLowerCase() === "r" && (input.meta || input.control) && !input.alt && !input.shift;
}
function isZoomShortcut(input) {
  if (input.type !== "keyDown" || !input.meta && !input.control || input.alt) {
    return false;
  }
  return ["+", "=", "-", "_", "0"].includes(input.key);
}
function configureApplicationMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...isMac ? [
      {
        label: appName,
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: "Settings...",
            accelerator: "Command+,",
            click: () => sendMenuCommand("settings")
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" }
        ]
      }
    ] : [],
    {
      label: "File",
      submenu: [
        {
          label: "Add Repository...",
          accelerator: isMac ? "Command+O" : "Ctrl+O",
          click: () => sendMenuCommand("add-repository")
        },
        {
          label: "Back",
          accelerator: isMac ? "Command+[" : "Alt+Left",
          click: () => sendMenuCommand("back")
        },
        ...isMac ? [] : [
          { type: "separator" },
          {
            label: "Settings...",
            accelerator: "Ctrl+,",
            click: () => sendMenuCommand("settings")
          },
          { type: "separator" },
          { role: "quit" }
        ]
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" }
      ]
    },
    {
      label: "Repository",
      submenu: [
        {
          label: "Refresh",
          accelerator: isMac ? "Command+R" : "Ctrl+R",
          click: () => sendThrottledRefreshCommand()
        },
        { type: "separator" },
        {
          label: "Open in Editor",
          accelerator: isMac ? "Command+E" : "Ctrl+E",
          click: () => sendMenuCommand("open-in-editor")
        },
        {
          label: "Open in Files",
          accelerator: isMac ? "Command+Shift+F" : "Ctrl+Shift+F",
          click: () => sendMenuCommand("open-in-file-manager")
        },
        {
          label: "Open in Terminal",
          accelerator: isMac ? "Command+`" : "Ctrl+`",
          click: () => sendMenuCommand("open-in-terminal")
        }
      ]
    },
    {
      label: "Scripts",
      submenu: [
        {
          label: "Stop Running Scripts",
          accelerator: isMac ? "Command+Shift+S" : "Ctrl+Shift+S",
          click: () => sendMenuCommand("stop-scripts")
        }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...isMac ? [
          { type: "separator" },
          { role: "front" }
        ] : [{ role: "close" }]
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
const repositoryService = createRepositoryService(repositoriesFilePath, shell);
const scriptRunner = createScriptRunner({ sendOutput: sendScriptOutput });
function registerRepositoryHandlers() {
  ipcMain.handle("repositories:list", repositoryService.listRepositories);
  ipcMain.handle("repositories:add-by-path", (_event, repoPath) => repositoryService.addRepository(repoPath));
  ipcMain.handle("repositories:remove", (_event, repoPath) => repositoryService.removeRepository(repoPath));
  ipcMain.handle("repositories:details", (_event, repoPath) => repositoryService.readRepositoryDetails(repoPath));
  ipcMain.handle(
    "repositories:checkout-branch",
    (_event, request) => repositoryService.checkoutBranch(request)
  );
  ipcMain.handle(
    "repositories:checkout-remote-branch",
    (_event, request) => repositoryService.checkoutRemoteBranch(request)
  );
  ipcMain.handle(
    "repositories:delete-branch",
    (_event, request) => repositoryService.deleteBranch(request)
  );
  ipcMain.handle(
    "repositories:sync-branch",
    (_event, request) => repositoryService.syncBranch(request)
  );
  ipcMain.handle(
    "repositories:stage-files",
    (_event, request) => repositoryService.stageFiles(request)
  );
  ipcMain.handle(
    "repositories:unstage-files",
    (_event, request) => repositoryService.unstageFiles(request)
  );
  ipcMain.handle(
    "repositories:diff-file",
    (_event, request) => repositoryService.diffFile(request)
  );
  ipcMain.handle("repositories:commit", (_event, request) => repositoryService.commit(request));
  ipcMain.handle(
    "repositories:open-in-file-manager",
    (_event, request) => repositoryService.openInFileManager(request)
  );
  ipcMain.handle(
    "repositories:open-in-editor",
    (_event, request) => repositoryService.openInEditor(request)
  );
  ipcMain.handle(
    "repositories:open-in-terminal",
    (_event, request) => repositoryService.openInTerminal(request)
  );
  ipcMain.handle("repositories:start-script", (_event, request) => scriptRunner.startScript(request));
  ipcMain.handle("repositories:stop-script", (_event, runId) => scriptRunner.stopScript(runId));
  ipcMain.handle("repositories:choose-and-add", chooseAndAddRepository);
  ipcMain.handle("desktop:notify", (_event, request) => {
    if (!Notification.isSupported()) {
      return false;
    }
    new Notification({
      title: request.title,
      body: request.body,
      icon: appIconPath()
    }).show();
    return true;
  });
  ipcMain.on("repositories:stop-scripts", (_event, runIds) => {
    for (const runId of runIds) {
      scriptRunner.stopScript(runId);
    }
  });
}
async function chooseAndAddRepository() {
  const dialogOptions = {
    properties: ["openDirectory"],
    title: "Add repository"
  };
  const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || !result.filePaths[0]) {
    return repositoryService.listRepositories();
  }
  return repositoryService.addRepository(result.filePaths[0]);
}
function createWindow() {
  win = new BrowserWindow({
    ...windowBounds,
    title: appName,
    icon: appIconPath(),
    ...process.platform === "darwin" ? {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 10 },
      vibrancy: "sidebar",
      visualEffectState: "active"
    } : {},
    webPreferences: {
      preload: path.join(currentDirectory, "preload.js")
    }
  });
  win.webContents.setZoomFactor(1);
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.on("focus", () => {
    win == null ? void 0 : win.webContents.send("repositories:window-focus");
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  win.webContents.on("before-input-event", (event, input) => {
    if (isZoomShortcut(input)) {
      event.preventDefault();
      win == null ? void 0 : win.webContents.setZoomFactor(1);
      return;
    }
    if (!isRepositoryRefreshShortcut(input)) {
      return;
    }
    event.preventDefault();
    sendThrottledRefreshCommand();
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
app.on("window-all-closed", () => {
  scriptRunner.stopAllScripts();
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
  configureAppIdentity();
  configureApplicationMenu();
  registerRepositoryHandlers();
  createWindow();
});
exports.MAIN_DIST = MAIN_DIST;
exports.RENDERER_DIST = RENDERER_DIST;
exports.VITE_DEV_SERVER_URL = VITE_DEV_SERVER_URL;
