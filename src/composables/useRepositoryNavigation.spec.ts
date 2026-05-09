import { describe, expect, it, vi } from "vitest";
import type { RepositoryApi, RepositoryDetails, RepositorySummary } from "../repositories";
import { useRepositoryNavigation } from "./useRepositoryNavigation";

const repoPath = "/work/app";
const otherRepoPath = "/work/api";

function repositorySummary(overrides: Partial<RepositorySummary> = {}): RepositorySummary {
  return {
    path: repoPath,
    name: "app",
    branch: "main",
    lastCommit: "Initial commit",
    dirty: false,
    taskCount: 0,
    ecosystems: [],
    ...overrides,
  };
}

function repositoryDetails(overrides: Partial<RepositoryDetails> = {}): RepositoryDetails {
  return {
    ...repositorySummary(),
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
    projectTasks: [],
    ...overrides,
  };
}

function installRepositoryApi(overrides: Partial<RepositoryApi> = {}) {
  const repositories = {
    details: vi.fn().mockResolvedValue(repositoryDetails()),
    ...overrides,
  };

  Object.defineProperty(window, "repositories", {
    configurable: true,
    value: repositories as unknown as RepositoryApi,
  });

  return repositories;
}

function createNavigation() {
  const calls = {
    clearCommitDraft: vi.fn(),
    clearError: vi.fn(),
    loadRepositories: vi.fn().mockResolvedValue(undefined),
    resetAutoRefreshTimer: vi.fn(),
    showRepositoryError: vi.fn(),
  };
  const navigation = useRepositoryNavigation(calls);

  return { calls, navigation };
}

describe("useRepositoryNavigation", () => {
  it("opens a repository by pushing history and loading repository details", async () => {
    const details = repositoryDetails();
    const repositories = installRepositoryApi({
      details: vi.fn().mockResolvedValue(details),
    });
    window.history.replaceState({ view: "dashboard" }, "");
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const { calls, navigation } = createNavigation();

    await navigation.openRepository(repositorySummary());

    expect(pushState).toHaveBeenCalledWith({ view: "repository", repoPath }, "");
    expect(replaceState).not.toHaveBeenCalledWith({ view: "repository", repoPath }, "");
    expect(repositories.details).toHaveBeenCalledWith(repoPath);
    expect(calls.clearError).toHaveBeenCalledTimes(1);
    expect(calls.resetAutoRefreshTimer).toHaveBeenCalledTimes(1);
    expect(navigation.selectedPath.value).toBe(repoPath);
    expect(navigation.selectedDetails.value).toEqual(details);
    expect(navigation.isDetailLoading.value).toBe(false);
  });

  it("replaces the current repository history entry when switching repositories", async () => {
    installRepositoryApi({
      details: vi.fn().mockResolvedValue(repositoryDetails({
        path: otherRepoPath,
        name: "api",
      })),
    });
    window.history.replaceState({ view: "repository", repoPath }, "");
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const { navigation } = createNavigation();

    await navigation.openRepository(repositorySummary({
      path: otherRepoPath,
      name: "api",
    }));

    expect(replaceState).toHaveBeenCalledWith({ view: "repository", repoPath: otherRepoPath }, "");
    expect(pushState).not.toHaveBeenCalled();
    expect(navigation.selectedPath.value).toBe(otherRepoPath);
  });

  it("reports repository detail load failures and clears stale details", async () => {
    const error = new Error("not a git repository");
    installRepositoryApi({
      details: vi.fn().mockRejectedValue(error),
    });
    const { calls, navigation } = createNavigation();
    navigation.selectedPath.value = repoPath;
    navigation.selectedDetails.value = repositoryDetails();

    await navigation.loadRepositoryDetails(repoPath);

    expect(navigation.selectedDetails.value).toBeNull();
    expect(navigation.isDetailLoading.value).toBe(false);
    expect(calls.showRepositoryError)
      .toHaveBeenCalledWith(repoPath, "Could not load repository details", error);
    expect(calls.resetAutoRefreshTimer).toHaveBeenCalledTimes(1);
  });

  it("refreshes the selected repository by reloading summaries before details", async () => {
    const details = repositoryDetails();
    const repositories = installRepositoryApi({
      details: vi.fn().mockResolvedValue(details),
    });
    const { calls, navigation } = createNavigation();
    navigation.selectedPath.value = repoPath;

    await navigation.refreshSelectedRepository();

    expect(calls.loadRepositories).toHaveBeenCalledTimes(1);
    expect(repositories.details).toHaveBeenCalledWith(repoPath);
    expect(navigation.selectedDetails.value).toEqual(details);
  });

  it("shows the dashboard and clears repository state for dashboard history entries", async () => {
    installRepositoryApi();
    const { calls, navigation } = createNavigation();
    navigation.selectedPath.value = repoPath;
    navigation.selectedDetails.value = repositoryDetails();

    await navigation.applyHistoryState({ view: "dashboard" });

    expect(navigation.selectedPath.value).toBeNull();
    expect(navigation.selectedDetails.value).toBeNull();
    expect(calls.clearCommitDraft).toHaveBeenCalledTimes(1);
    expect(calls.resetAutoRefreshTimer).toHaveBeenCalledTimes(1);
  });
});
