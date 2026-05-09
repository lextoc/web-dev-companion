import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStatusEntry, RepositoryApi, RepositoryDetails } from "../repositories";
import { useRepositoryStatusActions } from "./useRepositoryStatusActions";

const repoPath = "/work/app";

function statusEntry(path: string): GitStatusEntry {
  return {
    path,
    index: " ",
    workingTree: "M",
    label: "Modified",
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
    gitBranches: [],
    gitRemoteBranches: [],
    gitSubmodules: [],
    remotes: "",
    projectTasks: [],
    ...overrides,
  };
}

function installRepositoryApi() {
  const repositories = {
    commit: vi.fn(),
    resetTrackedChanges: vi.fn(),
    stageFiles: vi.fn(),
    unstageFiles: vi.fn(),
  };

  Object.defineProperty(window, "repositories", {
    configurable: true,
    value: repositories as unknown as RepositoryApi,
  });

  return repositories;
}

function createActions(options: {
  confirmAction?: ReturnType<typeof vi.fn>;
  isDetailLoading?: boolean;
  isLoading?: boolean;
  runHealthScriptsBeforeCommit?: ReturnType<typeof vi.fn>;
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
    runHealthScriptsBeforeCommit: options.runHealthScriptsBeforeCommit,
    showAppFeedback: vi.fn(),
    showRepositoryError: vi.fn(),
  };
  const actions = useRepositoryStatusActions({
    clearError: calls.clearError,
    confirmAction: calls.confirmAction,
    isDetailLoading: ref(options.isDetailLoading ?? false),
    isLoading: ref(options.isLoading ?? false),
    loadRepositories: calls.loadRepositories,
    resetAutoRefreshTimer: calls.resetAutoRefreshTimer,
    runHealthScriptsBeforeCommit: calls.runHealthScriptsBeforeCommit,
    selectedDetails,
    showAppFeedback: calls.showAppFeedback,
    showRepositoryError: calls.showRepositoryError,
  });

  return { actions, calls, selectedDetails };
}

describe("useRepositoryStatusActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("stages all unique unstaged, untracked, and conflicted paths", async () => {
    const repositories = installRepositoryApi();
    const nextDetails = repositoryDetails();
    repositories.stageFiles.mockResolvedValue(nextDetails);
    document.body.innerHTML = '<textarea id="commit-message"></textarea>';
    const commitMessageInput = document.getElementById("commit-message") as HTMLTextAreaElement;
    const focusSpy = vi.spyOn(commitMessageInput, "focus");
    const { actions, calls, selectedDetails } = createActions({
      selectedDetails: repositoryDetails({
        gitStatus: {
          branch: "main",
          clean: false,
          staged: [],
          unstaged: [statusEntry("src/App.vue"), statusEntry("src/App.vue")],
          untracked: [statusEntry("README.md")],
          conflicted: [statusEntry("package.json")],
          raw: "",
        },
      }),
    });

    await actions.stageAllChanges();

    expect(repositories.stageFiles).toHaveBeenCalledWith({
      repoPath,
      paths: ["src/App.vue", "README.md", "package.json"],
    });
    expect(calls.loadRepositories).toHaveBeenCalledTimes(1);
    expect(calls.showAppFeedback).toHaveBeenCalledWith("Staged 3 files.");
    expect(selectedDetails.value).toEqual(nextDetails);
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it("runs health checks before committing and clears the commit draft after success", async () => {
    const repositories = installRepositoryApi();
    const nextDetails = repositoryDetails();
    repositories.commit.mockResolvedValue(nextDetails);
    const runHealthScriptsBeforeCommit = vi.fn().mockResolvedValue(undefined);
    const { actions, calls, selectedDetails } = createActions({ runHealthScriptsBeforeCommit });

    actions.updateCommitDraft(true);
    await actions.commitStatus({
      checkHealthBeforeCommit: true,
      healthTaskIds: ["lint", "test"],
      message: "feat: add workflow",
    });

    expect(runHealthScriptsBeforeCommit).toHaveBeenCalledWith(
      expect.objectContaining({ path: repoPath }),
      ["lint", "test"],
    );
    expect(repositories.commit).toHaveBeenCalledWith({
      repoPath,
      message: "feat: add workflow",
    });
    expect(actions.commitClearToken.value).toBe(1);
    expect(actions.hasCommitDraft.value).toBe(false);
    expect(selectedDetails.value).toEqual(nextDetails);
    expect(calls.showRepositoryError).not.toHaveBeenCalled();
  });

  it("does not commit when a requested health check fails", async () => {
    const repositories = installRepositoryApi();
    const healthError = new Error("lint failed");
    const runHealthScriptsBeforeCommit = vi.fn().mockRejectedValue(healthError);
    const { actions, calls } = createActions({ runHealthScriptsBeforeCommit });

    await actions.commitStatus({
      checkHealthBeforeCommit: true,
      healthTaskIds: ["lint"],
      message: "fix: failing lint",
    });

    expect(repositories.commit).not.toHaveBeenCalled();
    expect(calls.showRepositoryError).toHaveBeenCalledWith(repoPath, "Health check failed.", healthError);
    expect(calls.resetAutoRefreshTimer).toHaveBeenCalledTimes(1);
  });

  it("resets only confirmed and normalized tracked change paths", async () => {
    const repositories = installRepositoryApi();
    repositories.resetTrackedChanges.mockResolvedValue(repositoryDetails());
    const confirmAction = vi.fn().mockResolvedValue(true);
    const { actions, calls } = createActions({
      confirmAction,
      selectedDetails: repositoryDetails({
        gitStatus: {
          branch: "main",
          clean: false,
          staged: [statusEntry("src/App.vue")],
          unstaged: [],
          untracked: [statusEntry("notes.txt")],
          conflicted: [],
          raw: "",
        },
      }),
    });

    await actions.resetTrackedChanges([" src/App.vue ", "", "src/App.vue"]);

    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({
      title: "Git reset",
      confirmLabel: "Git reset",
      danger: true,
    }));
    expect(repositories.resetTrackedChanges).toHaveBeenCalledWith({
      repoPath,
      paths: ["src/App.vue"],
    });
    expect(calls.showAppFeedback).toHaveBeenCalledWith("Reset 1 file.");
  });
});
