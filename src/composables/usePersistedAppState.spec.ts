import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppStateApi, PersistedAppState, RepositoryBranchLink } from "../app-state";
import type { PinnedScript, ProjectTask, RepositoryDetails, RepositorySummary } from "../repositories";
import { DEFAULT_APP_SETTINGS } from "../settings";
import { scriptReferenceKey, usePersistedAppState } from "./usePersistedAppState";

const repoPath = "/work/app";

function persistedState(overrides: Partial<PersistedAppState> = {}): PersistedAppState {
  return {
    settings: DEFAULT_APP_SETTINGS,
    pinnedRepositoryPaths: [],
    pinnedScripts: [],
    recentCommandIds: [],
    repositoryBranchLinks: [],
    ...overrides,
  };
}

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

function repositoryDetails(projectTasks: ProjectTask[]): RepositoryDetails {
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

function task(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: "dev",
    name: "Dev",
    command: "pnpm dev",
    source: "node",
    cwd: "/work/app",
    ...overrides,
  };
}

function pinnedScript(overrides: Partial<PinnedScript> = {}): PinnedScript {
  return {
    repoPath,
    repoName: "app",
    taskId: "dev",
    taskName: "Dev",
    command: "pnpm dev",
    source: "node",
    cwd: "/work/app",
    ...overrides,
  };
}

function branchLink(overrides: Partial<RepositoryBranchLink> = {}): RepositoryBranchLink {
  return {
    repoPath,
    parentBranch: "release/1",
    submodulePath: "packages/ui",
    submoduleBranch: "ui-release/1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function installAppStateApi(overrides: Partial<AppStateApi> = {}) {
  const appState = {
    read: vi.fn().mockResolvedValue(persistedState()),
    savePinnedRepositoryPaths: vi.fn(async (repoPaths: string[]) => repoPaths),
    savePinnedScripts: vi.fn(async (scripts: PinnedScript[]) => scripts),
    saveRecentCommandIds: vi.fn(async (commandIds: string[]) => commandIds),
    saveRepositoryBranchLinks: vi.fn(async (links: RepositoryBranchLink[]) => links),
    saveSettings: vi.fn(),
    ...overrides,
  };

  Object.defineProperty(window, "appState", {
    configurable: true,
    value: appState as unknown as AppStateApi,
  });

  return appState;
}

function createPersistedState(options: {
  repositories?: RepositorySummary[];
  selectedDetails?: RepositoryDetails | null;
} = {}) {
  const calls = {
    showAppFeedback: vi.fn(),
    showError: vi.fn(),
  };
  const state = usePersistedAppState({
    repositories: ref(options.repositories ?? [repositorySummary()]),
    selectedDetails: ref(options.selectedDetails ?? null),
    showAppFeedback: calls.showAppFeedback,
    showError: calls.showError,
  });

  return { calls, state };
}

describe("usePersistedAppState", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("loads persisted pins and trims recent commands to the display limit", async () => {
    installAppStateApi({
      read: vi.fn().mockResolvedValue(persistedState({
        pinnedRepositoryPaths: [repoPath],
        pinnedScripts: [pinnedScript()],
        recentCommandIds: ["one", "two", "three", "four", "five", "six", "seven"],
        repositoryBranchLinks: [branchLink()],
      })),
    });
    const { state } = createPersistedState({
      selectedDetails: repositoryDetails([task()]),
    });

    await state.loadPersistedAppState();

    expect(state.pinnedRepositoryPaths.value).toEqual([repoPath]);
    expect(state.pinnedScripts.value).toEqual([pinnedScript()]);
    expect(state.recentCommandIds.value).toEqual(["one", "two", "three", "four", "five", "six"]);
    expect(state.repositoryBranchLinks.value).toEqual([branchLink()]);
    expect(state.pinnedTaskIdsForSelectedRepo.value).toEqual(["dev"]);
  });

  it("toggles pinned scripts through serialized app-state saves", async () => {
    const appState = installAppStateApi();
    const currentTask = task();
    const { calls, state } = createPersistedState({
      selectedDetails: repositoryDetails([currentTask]),
    });

    await state.togglePinnedScript(currentTask);

    expect(appState.savePinnedScripts).toHaveBeenCalledWith([pinnedScript()]);
    expect(state.pinnedScripts.value).toEqual([pinnedScript()]);
    expect(calls.showAppFeedback).toHaveBeenCalledWith("Pinned Dev.", "info");

    await state.togglePinnedScript(currentTask);

    expect(appState.savePinnedScripts).toHaveBeenLastCalledWith([]);
    expect(state.pinnedScripts.value).toEqual([]);
    expect(calls.showAppFeedback).toHaveBeenLastCalledWith("Unpinned Dev.", "info");
  });

  it("rolls back optimistic pinned repository changes when saving fails", async () => {
    const error = new Error("disk full");
    const appState = installAppStateApi({
      savePinnedRepositoryPaths: vi.fn().mockRejectedValue(error),
    });
    const { calls, state } = createPersistedState();
    state.pinnedRepositoryPaths.value = ["/work/api"];

    await state.togglePinnedRepository(repoPath);

    expect(appState.savePinnedRepositoryPaths).toHaveBeenCalledWith([repoPath, "/work/api"]);
    expect(state.pinnedRepositoryPaths.value).toEqual(["/work/api"]);
    expect(calls.showAppFeedback).not.toHaveBeenCalled();
    expect(calls.showError).toHaveBeenCalledWith(error);
  });

  it("moves saved repository branch links to the front and replaces existing matches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-09T12:00:00.000Z"));
    const appState = installAppStateApi();
    const existingLink = branchLink({
      submoduleBranch: "old-ui-release/1",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const unrelatedLink = branchLink({
      parentBranch: "release/2",
      submoduleBranch: "ui-release/2",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const { calls, state } = createPersistedState();
    state.repositoryBranchLinks.value = [unrelatedLink, existingLink];

    await state.saveRepositoryBranchLink({
      repoPath,
      parentBranch: "release/1",
      submodulePath: "packages/ui",
      submoduleBranch: "ui-release/1",
    });

    const savedLink = branchLink({ updatedAt: "2026-05-09T12:00:00.000Z" });

    expect(appState.saveRepositoryBranchLinks).toHaveBeenCalledWith([savedLink, unrelatedLink]);
    expect(state.repositoryBranchLinks.value).toEqual([savedLink, unrelatedLink]);
    expect(calls.showAppFeedback).toHaveBeenCalledWith("Linked release/1 to ui-release/1.", "info");
  });

  it("keeps only one recent entry per command and persists the capped order", async () => {
    const appState = installAppStateApi();
    const { state } = createPersistedState();
    state.recentCommandIds.value = ["action:refresh", "action:add-repository", "action:settings"];

    state.rememberCommand("action:add-repository");

    await vi.waitFor(() =>
      expect(appState.saveRecentCommandIds).toHaveBeenCalledWith([
        "action:add-repository",
        "action:refresh",
        "action:settings",
      ]),
    );
    expect(state.recentCommandIds.value).toEqual([
      "action:add-repository",
      "action:refresh",
      "action:settings",
    ]);
  });

  it("builds stable pinned script keys from repository path and task id", () => {
    expect(scriptReferenceKey(pinnedScript())).toBe(`${repoPath}\ndev`);
  });
});
