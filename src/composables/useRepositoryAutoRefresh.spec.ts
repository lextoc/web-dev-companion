import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../settings";
import { DEFAULT_APP_SETTINGS } from "../settings";
import { useRepositoryAutoRefresh } from "./useRepositoryAutoRefresh";

function createAutoRefresh(overrides: {
  appSettings?: AppSettings;
  deletingBranchName?: string | null;
  deletingSubmoduleBranchName?: string | null;
  checkingOutSubmoduleBranchName?: string | null;
  hasCommitDraft?: boolean;
  hasRunningScripts?: boolean;
  isDetailLoading?: boolean;
  isLoading?: boolean;
  mergingBranchName?: string | null;
  mergingLinkedBranchName?: string | null;
  pendingStatusActionKey?: string | null;
  selectedPath?: string | null;
  syncingBranchName?: string | null;
  syncingSubmoduleBranchName?: string | null;
} = {}) {
  const calls = {
    loadRepositories: vi.fn().mockResolvedValue(undefined),
    refreshSelectedRepository: vi.fn().mockResolvedValue(undefined),
  };
  const flags = {
    appSettings: ref(overrides.appSettings ?? {
      ...DEFAULT_APP_SETTINGS,
      autoRefreshIntervalMs: 5_000,
    }),
    deletingBranchName: ref(overrides.deletingBranchName ?? null),
    deletingSubmoduleBranchName: ref(overrides.deletingSubmoduleBranchName ?? null),
    checkingOutSubmoduleBranchName: ref(overrides.checkingOutSubmoduleBranchName ?? null),
    hasCommitDraft: ref(overrides.hasCommitDraft ?? false),
    hasRunningScripts: ref(overrides.hasRunningScripts ?? false),
    isDetailLoading: ref(overrides.isDetailLoading ?? false),
    isLoading: ref(overrides.isLoading ?? false),
    mergingBranchName: ref(overrides.mergingBranchName ?? null),
    mergingLinkedBranchName: ref(overrides.mergingLinkedBranchName ?? null),
    pendingStatusActionKey: ref(overrides.pendingStatusActionKey ?? null),
    selectedPath: ref(overrides.selectedPath ?? null),
    syncingBranchName: ref(overrides.syncingBranchName ?? null),
    syncingSubmoduleBranchName: ref(overrides.syncingSubmoduleBranchName ?? null),
  };
  const state = useRepositoryAutoRefresh({
    ...flags,
    loadRepositories: calls.loadRepositories,
    refreshSelectedRepository: calls.refreshSelectedRepository,
  });

  return { calls, flags, state };
}

describe("useRepositoryAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-09T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks countdown state when the timer is reset", () => {
    const { state } = createAutoRefresh();

    state.resetAutoRefreshTimer();
    vi.advanceTimersByTime(2_000);

    expect(state.autoRefreshRemainingMs.value).toBe(3_000);
    expect(state.autoRefreshProgress.value).toBe(60);
    expect(state.autoRefreshLabel.value).toBe("0:03 until auto refresh");
  });

  it("refreshes repositories on window focus and throttles repeated focus events", async () => {
    const { calls, state } = createAutoRefresh();

    await state.refreshOnWindowFocus();
    await state.refreshOnWindowFocus();
    vi.advanceTimersByTime(2_000);
    await state.refreshOnWindowFocus();

    expect(calls.loadRepositories).toHaveBeenCalledTimes(2);
    expect(calls.refreshSelectedRepository).not.toHaveBeenCalled();
  });

  it("refreshes the selected repository on window focus when a repository is open", async () => {
    const { calls, state } = createAutoRefresh({ selectedPath: "/work/app" });

    await state.refreshOnWindowFocus();

    expect(calls.refreshSelectedRepository).toHaveBeenCalledTimes(1);
    expect(calls.loadRepositories).not.toHaveBeenCalled();
  });

  it("does not refresh on focus while blocking work is active", async () => {
    const { calls, state } = createAutoRefresh({
      hasCommitDraft: true,
      selectedPath: "/work/app",
    });

    await state.refreshOnWindowFocus();

    expect(calls.refreshSelectedRepository).not.toHaveBeenCalled();
    expect(calls.loadRepositories).not.toHaveBeenCalled();
  });

  it("runs an automatic refresh when the countdown expires", async () => {
    const { calls, state } = createAutoRefresh({ selectedPath: "/work/app" });

    state.resetAutoRefreshTimer();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(calls.refreshSelectedRepository).toHaveBeenCalledTimes(1);
    expect(calls.loadRepositories).not.toHaveBeenCalled();
    expect(state.autoRefreshRemainingMs.value).toBe(5_000);
  });

  it("defers automatic refresh while scripts are running", async () => {
    const { calls, flags, state } = createAutoRefresh({
      hasRunningScripts: true,
      selectedPath: "/work/app",
    });

    state.resetAutoRefreshTimer();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(calls.refreshSelectedRepository).not.toHaveBeenCalled();
    expect(state.autoRefreshRemainingMs.value).toBe(5_000);

    flags.hasRunningScripts.value = false;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(calls.refreshSelectedRepository).toHaveBeenCalledTimes(1);
  });
});
