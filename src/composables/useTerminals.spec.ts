import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, RepositoryApi, RepositoryDetails, ProjectTask } from "../repositories";
import { useTerminals } from "./useTerminals";

const repoPath = "/work/app";

function task(overrides: Partial<ProjectTask>): ProjectTask {
  return {
    id: "dev",
    name: "Dev",
    command: "pnpm dev",
    source: "node",
    ...overrides,
  };
}

function repositoryDetails(projectTasks: ProjectTask[]): RepositoryDetails {
  return {
    path: repoPath,
    name: "app",
    branch: "main",
    lastCommit: "Initial commit",
    dirty: false,
    taskCount: projectTasks.length,
    ecosystems: ["node"],
    gitLog: [],
    gitStatus: {
      branch: "main",
      clean: true,
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
      raw: "",
    },
    gitBranches: [],
    gitRemoteBranches: [],
    gitSubmodules: [],
    remotes: "",
    projectTasks,
  };
}

function installApis() {
  const repositories = {
    startScript: vi.fn(),
    stopScript: vi.fn().mockResolvedValue(true),
    stopScripts: vi.fn(),
  };
  const desktop = {
    closeTerminalWindow: vi.fn(),
    notify: vi.fn().mockResolvedValue(true),
    openTerminalWindow: vi.fn().mockResolvedValue(true),
    reassignTerminalWindow: vi.fn(),
    updateTerminalWindow: vi.fn(),
  };

  Object.defineProperty(window, "repositories", {
    configurable: true,
    value: repositories as unknown as RepositoryApi,
  });
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: desktop as unknown as DesktopApi,
  });

  return { desktop, repositories };
}

describe("useTerminals", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("starts a selected repository task and records streamed output", async () => {
    const { desktop, repositories } = installApis();
    repositories.startScript.mockResolvedValue({ runId: "run-1", command: "pnpm lint" });
    const clearError = vi.fn();
    const showError = vi.fn();
    const selectedDetails = ref(repositoryDetails([
      task({ id: "lint", name: "Lint", command: "pnpm lint" }),
    ]));
    const terminals = useTerminals({ clearError, selectedDetails, showError });

    await terminals.runScript("lint");

    expect(clearError).toHaveBeenCalledTimes(1);
    expect(repositories.startScript).toHaveBeenCalledWith({ repoPath, taskId: "lint" });
    expect(terminals.hasRunningScripts.value).toBe(true);
    expect(terminals.currentRepoScriptTerminals.value.lint.output).toBe("$ pnpm lint\n");

    terminals.handleScriptOutput({
      runId: "run-1",
      stream: "stdout",
      text: "ok\n",
      exitCode: 0,
      done: true,
    });

    expect(terminals.currentRepoScriptTerminals.value.lint).toMatchObject({
      output: "$ pnpm lint\nok\n",
      isRunning: false,
      exitCode: 0,
      signal: null,
    });
    expect(desktop.updateTerminalWindow).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      output: "$ pnpm lint\nok\n",
      isRunning: false,
    }));
    expect(desktop.notify).not.toHaveBeenCalled();
  });

  it("deduplicates task ids when running repository scripts and waits for completion", async () => {
    const { repositories } = installApis();
    repositories.startScript
      .mockResolvedValueOnce({ runId: "lint-run", command: "pnpm lint" })
      .mockResolvedValueOnce({ runId: "test-run", command: "pnpm test" });
    const selectedDetails = ref<RepositoryDetails | null>(null);
    const terminals = useTerminals({
      clearError: vi.fn(),
      selectedDetails,
      showError: vi.fn(),
    });
    const repository = repositoryDetails([
      task({ id: "lint", name: "Lint", command: "pnpm lint" }),
      task({ id: "test", name: "Test", command: "pnpm test" }),
    ]);

    const resultPromise = terminals.runRepositoryScriptsAndWait(repository, ["lint", "lint", "test"]);
    await vi.waitFor(() => expect(repositories.startScript).toHaveBeenCalledTimes(2));

    terminals.handleScriptOutput({
      runId: "lint-run",
      stream: "stdout",
      text: "lint passed\n",
      exitCode: 0,
      done: true,
    });
    terminals.handleScriptOutput({
      runId: "test-run",
      stream: "stdout",
      text: "tests passed\n",
      exitCode: 0,
      done: true,
    });

    await expect(resultPromise).resolves.toEqual([
      { runId: "lint-run", taskName: "Lint", exitCode: 0, signal: undefined },
      { runId: "test-run", taskName: "Test", exitCode: 0, signal: undefined },
    ]);
    expect(repositories.startScript).toHaveBeenNthCalledWith(1, { repoPath, taskId: "lint" });
    expect(repositories.startScript).toHaveBeenNthCalledWith(2, { repoPath, taskId: "test" });
  });

  it("stops owned scripts and closes their detached terminal windows", async () => {
    const { desktop, repositories } = installApis();
    repositories.startScript.mockResolvedValue({ runId: "run-1", command: "pnpm dev" });
    const selectedDetails = ref(repositoryDetails([
      task({ id: "dev", name: "Dev", command: "pnpm dev" }),
    ]));
    const terminals = useTerminals({
      clearError: vi.fn(),
      selectedDetails,
      showError: vi.fn(),
    });

    await terminals.runScript("dev");
    terminals.stopOwnedScripts();

    expect(repositories.stopScripts).toHaveBeenCalledWith(["run-1"]);
    expect(desktop.closeTerminalWindow).toHaveBeenCalledWith("run-1");
    expect(terminals.activeTerminals.value).toEqual([]);
    expect(terminals.hasRunningScripts.value).toBe(false);
  });
});
