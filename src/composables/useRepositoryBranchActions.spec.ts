import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitBranchEntry, RepositoryApi, RepositoryDetails } from "../repositories";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../settings";
import { useRepositoryBranchActions } from "./useRepositoryBranchActions";

const repoPath = "/work/app";

function branch(overrides: Partial<GitBranchEntry> = {}): GitBranchEntry {
  return {
    name: "main",
    upstream: "origin/main",
    current: true,
    ahead: 0,
    behind: 0,
    remoteGone: false,
    inSyncWithRemote: true,
    canDelete: false,
    ...overrides,
  };
}

function repositoryDetails(overrides: Partial<RepositoryDetails> = {}): RepositoryDetails {
  return {
    path: repoPath,
    name: "app",
    branch: "main",
    lastCommit: "Initial commit",
    dirty: false,
    taskCount: 0,
    ecosystems: [],
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
    gitBranches: [branch()],
    gitRemoteBranches: [],
    gitSubmodules: [],
    remotes: "",
    projectTasks: [],
    ...overrides,
  };
}

function installRepositoryApi(overrides: Partial<RepositoryApi> = {}) {
  const repositories = {
    checkoutBranch: vi.fn(),
    checkoutRemoteBranch: vi.fn(),
    checkoutSubmoduleBranch: vi.fn(),
    deleteBranch: vi.fn(),
    deleteSubmoduleBranch: vi.fn(),
    details: vi.fn(),
    mergeBranch: vi.fn(),
    mergeLinkedSubmoduleBranch: vi.fn(),
    syncBranch: vi.fn(),
    syncSubmoduleBranch: vi.fn(),
    ...overrides,
  };

  Object.defineProperty(window, "repositories", {
    configurable: true,
    value: repositories as unknown as RepositoryApi,
  });

  return repositories;
}

function createBranchActions(options: {
  appSettings?: AppSettings;
  confirmAction?: ReturnType<typeof vi.fn>;
  selectedDetails?: RepositoryDetails | null;
} = {}) {
  const selectedDetails = ref<RepositoryDetails | null>(
    options.selectedDetails === undefined ? repositoryDetails() : options.selectedDetails,
  );
  const calls = {
    clearError: vi.fn(),
    confirmAction: options.confirmAction ?? vi.fn().mockResolvedValue(true),
    loadRepositories: vi.fn().mockResolvedValue(undefined),
    resetAutoRefreshTimer: vi.fn(),
    showAppFeedback: vi.fn(),
    showRepositoryError: vi.fn(),
  };
  const actions = useRepositoryBranchActions({
    appSettings: ref(options.appSettings ?? DEFAULT_APP_SETTINGS),
    clearError: calls.clearError,
    confirmAction: calls.confirmAction,
    loadRepositories: calls.loadRepositories,
    resetAutoRefreshTimer: calls.resetAutoRefreshTimer,
    selectedDetails,
    showAppFeedback: calls.showAppFeedback,
    showRepositoryError: calls.showRepositoryError,
  });

  return { actions, calls, selectedDetails };
}

describe("useRepositoryBranchActions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-09T12:00:00.000Z"));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("syncs a pushable branch without confirmation when the setting skips prompts", async () => {
    const syncedDetails = repositoryDetails({
      branch: "feature",
      gitBranches: [branch({
        name: "feature",
        ahead: 1,
        inSyncWithRemote: false,
        canDelete: true,
      })],
    });
    const repositories = installRepositoryApi({
      syncBranch: vi.fn().mockResolvedValue({
        details: syncedDetails,
        pushed: true,
      }),
    });
    const { actions, calls, selectedDetails } = createBranchActions({
      appSettings: {
        ...DEFAULT_APP_SETTINGS,
        skipBranchSyncConfirmation: true,
      },
      selectedDetails: repositoryDetails({
        gitBranches: [branch({
          name: "feature",
          ahead: 1,
          inSyncWithRemote: false,
          canDelete: true,
        })],
      }),
    });

    await actions.syncBranch("feature");

    expect(calls.confirmAction).not.toHaveBeenCalled();
    expect(repositories.syncBranch).toHaveBeenCalledWith({ repoPath, branchName: "feature" });
    expect(selectedDetails.value).toEqual(syncedDetails);
    expect(actions.syncCelebrationToken.value).toBe(1);
    expect(actions.branchFeedbackMessages.value).toEqual({ feature: "Pushed" });
    expect(calls.showAppFeedback).toHaveBeenCalledWith("Pushed branch feature.");
    expect(calls.resetAutoRefreshTimer).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4_000);
    expect(actions.branchFeedbackMessages.value).toEqual({});
  });

  it("does not delete a branch when confirmation is rejected", async () => {
    const repositories = installRepositoryApi();
    const { actions, calls } = createBranchActions({
      confirmAction: vi.fn().mockResolvedValue(false),
    });

    await actions.deleteBranch("feature");

    expect(calls.confirmAction).toHaveBeenCalledWith(expect.objectContaining({
      title: "Remove local branch",
      confirmLabel: "Remove branch",
      danger: true,
    }));
    expect(repositories.deleteBranch).not.toHaveBeenCalled();
    expect(actions.deletingBranchName.value).toBeNull();
  });

  it("checks out a branch and clears transient feedback after the dismiss delay", async () => {
    const checkedOutDetails = repositoryDetails({
      branch: "feature",
      gitBranches: [branch({
        name: "feature",
        current: true,
        canDelete: true,
      })],
    });
    const repositories = installRepositoryApi({
      checkoutBranch: vi.fn().mockResolvedValue(checkedOutDetails),
    });
    const { actions, calls, selectedDetails } = createBranchActions();

    await actions.checkoutBranch("feature");

    expect(repositories.checkoutBranch).toHaveBeenCalledWith({ repoPath, branchName: "feature" });
    expect(selectedDetails.value).toEqual(checkedOutDetails);
    expect(actions.checkingOutBranchName.value).toBeNull();
    expect(actions.branchFeedbackMessages.value).toEqual({ feature: "Checked out" });
    expect(calls.loadRepositories).toHaveBeenCalledTimes(1);
    expect(calls.showAppFeedback).toHaveBeenCalledWith("Checked out branch feature.");

    vi.advanceTimersByTime(4_000);
    expect(actions.branchFeedbackMessages.value).toEqual({});
  });

  it("refreshes repository details after a failed merge while preserving the merge error", async () => {
    const mergeError = new Error("merge conflict");
    const refreshedDetails = repositoryDetails({
      gitStatus: {
        branch: "main",
        clean: false,
        staged: [],
        unstaged: [{
          path: "src/App.vue",
          index: " ",
          workingTree: "M",
          label: "Modified",
        }],
        untracked: [],
        conflicted: [],
        raw: "",
      },
    });
    const repositories = installRepositoryApi({
      details: vi.fn().mockResolvedValue(refreshedDetails),
      mergeBranch: vi.fn().mockRejectedValue(mergeError),
    });
    const { actions, calls, selectedDetails } = createBranchActions();

    await actions.mergeBranch({
      sourceBranch: "feature",
      targetBranch: "main",
    });

    expect(repositories.mergeBranch).toHaveBeenCalledWith({
      repoPath,
      sourceBranch: "feature",
      targetBranch: "main",
    });
    expect(repositories.details).toHaveBeenCalledWith(repoPath);
    expect(selectedDetails.value).toEqual(refreshedDetails);
    expect(actions.mergingBranchName.value).toBeNull();
    expect(calls.loadRepositories).toHaveBeenCalledTimes(1);
    expect(calls.showRepositoryError).toHaveBeenCalledWith(
      repoPath,
      "Could not merge branches",
      mergeError,
    );
    expect(calls.resetAutoRefreshTimer).toHaveBeenCalledTimes(1);
  });
});
