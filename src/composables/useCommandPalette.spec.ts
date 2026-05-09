import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { PinnedScript, ProjectTask, RepositoryDetails, RepositorySummary, ScriptTerminal } from "../repositories";
import { useCommandPalette } from "./useCommandPalette";

const repoPath = "/work/app";
const otherRepoPath = "/work/api";

function repositorySummary(overrides: Partial<RepositorySummary> = {}): RepositorySummary {
  return {
    path: repoPath,
    name: "app",
    branch: "main",
    lastCommit: "Initial commit",
    dirty: false,
    taskCount: 1,
    ecosystems: ["node"],
    ...overrides,
  };
}

function task(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: "dev",
    name: "Dev",
    command: "pnpm dev",
    source: "node",
    ...overrides,
  };
}

function repositoryDetails(projectTasks: ProjectTask[] = [task()]): RepositoryDetails {
  return {
    ...repositorySummary({ taskCount: projectTasks.length }),
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

function pinnedScript(overrides: Partial<PinnedScript> = {}): PinnedScript {
  return {
    repoPath: otherRepoPath,
    repoName: "api",
    taskId: "serve",
    taskName: "Serve",
    command: "pnpm serve",
    source: "node",
    ...overrides,
  };
}

function terminal(overrides: Partial<ScriptTerminal> = {}): ScriptTerminal {
  return {
    runId: "run-1",
    repoPath,
    repoName: "app",
    taskId: "dev",
    taskName: "Dev",
    source: "node",
    command: "pnpm dev",
    output: "",
    isRunning: true,
    startedAt: 0,
    exitCode: null,
    signal: null,
    ...overrides,
  };
}

function createPalette(options: {
  activeTerminals?: ScriptTerminal[];
  pinnedScripts?: PinnedScript[];
  recentCommandIds?: string[];
  repositories?: RepositorySummary[];
  selectedDetails?: RepositoryDetails | null;
  selectedPath?: string | null;
  selectedSummary?: RepositorySummary | undefined;
} = {}) {
  const activeTerminals = ref(options.activeTerminals ?? []);
  const selectedSummary = ref(options.selectedSummary);
  const calls = {
    chooseAndAddRepository: vi.fn().mockResolvedValue(undefined),
    copyRepositoryPath: vi.fn().mockResolvedValue(undefined),
    loadRepositories: vi.fn().mockResolvedValue(undefined),
    openKeybindingsSheet: vi.fn(),
    openRepository: vi.fn().mockResolvedValue(undefined),
    openRepositoryInEditor: vi.fn().mockResolvedValue(undefined),
    openRepositoryInFileManager: vi.fn().mockResolvedValue(undefined),
    openRepositoryInTerminal: vi.fn().mockResolvedValue(undefined),
    openTerminal: vi.fn(),
    refreshSelectedRepository: vi.fn().mockResolvedValue(undefined),
    rememberCommand: vi.fn(),
    runRepositoryScript: vi.fn().mockResolvedValue(undefined),
    runScript: vi.fn().mockResolvedValue(undefined),
    showAppFeedback: vi.fn(),
    stopOwnedScripts: vi.fn(),
  };
  const state = useCommandPalette({
    activeTerminals: computed(() => activeTerminals.value),
    chooseAndAddRepository: calls.chooseAndAddRepository,
    copyRepositoryPath: calls.copyRepositoryPath,
    hasRunningScripts: computed(() => activeTerminals.value.some((entry) => entry.isRunning)),
    isMacPlatform: ref(false),
    isSettingsOpen: ref(false),
    loadRepositories: calls.loadRepositories,
    openKeybindingsSheet: calls.openKeybindingsSheet,
    openRepository: calls.openRepository,
    openRepositoryInEditor: calls.openRepositoryInEditor,
    openRepositoryInFileManager: calls.openRepositoryInFileManager,
    openRepositoryInTerminal: calls.openRepositoryInTerminal,
    openTerminal: calls.openTerminal,
    pinnedScripts: ref(options.pinnedScripts ?? []),
    recentCommandIds: ref(options.recentCommandIds ?? []),
    refreshSelectedRepository: calls.refreshSelectedRepository,
    rememberCommand: calls.rememberCommand,
    repositories: ref(options.repositories ?? [repositorySummary()]),
    runRepositoryScript: calls.runRepositoryScript,
    runScript: calls.runScript,
    selectedDetails: ref(options.selectedDetails ?? null),
    selectedPath: ref(options.selectedPath ?? null),
    selectedSummary: computed(() => selectedSummary.value),
    showAppFeedback: calls.showAppFeedback,
    stopOwnedScripts: calls.stopOwnedScripts,
  });

  return { calls, state };
}

describe("useCommandPalette", () => {
  it("builds app, repository, task, terminal, and recent command items", () => {
    const currentTask = task({ id: "lint", name: "Lint", command: "pnpm lint" });
    const runningTerminal = terminal({ runId: "run-lint", taskId: "lint", taskName: "Lint" });
    const savedPinnedScript = pinnedScript();
    const { state } = createPalette({
      activeTerminals: [runningTerminal],
      pinnedScripts: [savedPinnedScript],
      recentCommandIds: ["action:refresh", `terminal:${runningTerminal.runId}`, "missing"],
      selectedDetails: repositoryDetails([currentTask]),
      selectedPath: repoPath,
    });

    const itemIds = state.commandPaletteItems.value.map((item) => item.id);

    expect(itemIds.slice(0, 2)).toEqual(["recent:action:refresh", "recent:terminal:run-lint"]);
    expect(itemIds).toEqual(expect.arrayContaining([
      "action:add-repository",
      "action:refresh",
      "action:open-files",
      "action:open-editor",
      "action:open-terminal",
      "action:copy-path",
      "action:stop-scripts",
      `repository:${repoPath}`,
      `script:${repoPath}\nlint`,
      `script:${otherRepoPath}\nserve`,
      "terminal:run-lint",
    ]));
    expect(state.commandPaletteItems.value.find((item) => item.id === "action:stop-scripts")?.subtitle)
      .toBe("1 running");
    expect(state.commandPaletteItems.value.find((item) => item.id === `script:${otherRepoPath}\nserve`)?.section)
      .toBe("Pinned tasks");
  });

  it("routes app commands and remembers executed command ids", async () => {
    const { calls, state } = createPalette({ selectedPath: repoPath });

    state.openCommandPalette();
    await state.runCommandPaletteItem("action:refresh");
    await state.runCommandPaletteItem("action:stop-scripts");

    expect(state.isCommandPaletteOpen.value).toBe(false);
    expect(calls.refreshSelectedRepository).toHaveBeenCalledTimes(1);
    expect(calls.loadRepositories).not.toHaveBeenCalled();
    expect(calls.stopOwnedScripts).toHaveBeenCalledTimes(1);
    expect(calls.showAppFeedback).toHaveBeenCalledWith("Stopped running tasks.", "info");
    expect(calls.rememberCommand).toHaveBeenNthCalledWith(1, "action:refresh");
    expect(calls.rememberCommand).toHaveBeenNthCalledWith(2, "action:stop-scripts");
  });

  it("runs selected repository scripts directly and pinned scripts through their repository context", async () => {
    const savedPinnedScript = pinnedScript();
    const { calls, state } = createPalette({
      pinnedScripts: [savedPinnedScript],
      selectedDetails: repositoryDetails([task({ id: "lint", name: "Lint" })]),
    });

    await state.runCommandPaletteItem(`script:${repoPath}\nlint`);
    await state.runCommandPaletteItem(`script:${otherRepoPath}\nserve`);

    expect(calls.runScript).toHaveBeenCalledWith("lint");
    expect(calls.runRepositoryScript).toHaveBeenCalledWith(savedPinnedScript);
  });

  it("routes repository, current-repository, and terminal actions", async () => {
    const repository = repositorySummary();
    const { calls, state } = createPalette({
      repositories: [repository],
      selectedSummary: repository,
    });

    await state.runCommandPaletteItem(`repository:${repoPath}`);
    await state.runCommandPaletteItem("action:open-editor");
    await state.runCommandPaletteItem("action:copy-path");
    await state.runCommandPaletteItem("terminal:run-1");

    expect(calls.openRepository).toHaveBeenCalledWith(repository);
    expect(calls.openRepositoryInEditor).toHaveBeenCalledWith(repoPath);
    expect(calls.copyRepositoryPath).toHaveBeenCalledWith(repoPath);
    expect(calls.openTerminal).toHaveBeenCalledWith("run-1");
  });
});
