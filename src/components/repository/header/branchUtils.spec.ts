import { describe, expect, it } from "vitest";
import type { RepositoryDetails } from "../../../repositories";
import {
  branchMatchesFilter,
  branchSafetyNotes,
  branchSyncActionIcon,
  branchSyncActionLabel,
  branchSyncDisabledReason,
  branchSyncLabel,
  compareBranchNamesDescending,
  inferNextNumberedBranch,
  isBranchSyncActionReady,
} from "./branchUtils";

type Branch = RepositoryDetails["gitBranches"][number];
type GitStatus = RepositoryDetails["gitStatus"];

function branch(overrides: Partial<Branch>): Branch {
  return {
    name: "feature",
    current: false,
    ahead: 0,
    behind: 0,
    remoteGone: false,
    inSyncWithRemote: true,
    canDelete: true,
    ...overrides,
  };
}

function gitStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: "main",
    clean: true,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    raw: "",
    ...overrides,
  };
}

describe("branch utils", () => {
  it("infers the next numbered branch only when it already exists", () => {
    expect(inferNextNumberedBranch("release/001", ["release/001", "release/002"])).toBe("release/002");
    expect(inferNextNumberedBranch("release/001", ["release/003"])).toBe("");
    expect(inferNextNumberedBranch("main", ["main"])).toBe("");
  });

  it("sorts branch names descending with numeric awareness", () => {
    expect(["release/2", "release/10", "release/1"].sort(compareBranchNamesDescending)).toEqual([
      "release/10",
      "release/2",
      "release/1",
    ]);
  });

  it("reports sync labels and actions from branch metadata", () => {
    expect(branchSyncLabel(branch({ upstream: undefined }))).toBe("No upstream");
    expect(branchSyncLabel(branch({ upstream: "origin/main" }))).toBe("In sync");
    expect(branchSyncLabel(branch({ upstream: "origin/main", remoteGone: true, inSyncWithRemote: false })))
      .toBe("Remote gone");
    expect(branchSyncLabel(branch({ upstream: "origin/main", ahead: 2, behind: 3, inSyncWithRemote: false })))
      .toBe("2 ahead, 3 behind");

    const pushable = branch({ upstream: "origin/main", ahead: 1, inSyncWithRemote: false });
    const pullable = branch({ upstream: "origin/main", behind: 1, inSyncWithRemote: false });

    expect(branchSyncActionLabel(pushable)).toBe("Push");
    expect(branchSyncActionIcon(pushable, null)).toBe("push");
    expect(branchSyncActionLabel(pullable)).toBe("Pull");
    expect(branchSyncActionIcon(pullable, null)).toBe("pull");
    expect(branchSyncActionIcon(pullable, pullable.name)).toBe("restart");
  });

  it("blocks sync actions when local state or branch metadata is unsafe", () => {
    const pushable = branch({ upstream: "origin/main", ahead: 1, inSyncWithRemote: false });
    const dirtyStatus = gitStatus({
      unstaged: [{
        path: "src/App.vue",
        index: " ",
        workingTree: "M",
        label: "Modified",
      }],
    });

    expect(branchSyncDisabledReason(pushable, dirtyStatus))
      .toBe("Commit, stash, or discard staged and unstaged changes before syncing.");
    expect(isBranchSyncActionReady(pushable, dirtyStatus)).toBe(false);
    expect(branchSafetyNotes(pushable, dirtyStatus)).toEqual([
      "Commit, stash, or discard staged and unstaged changes before syncing.",
    ]);
    expect(branchSyncDisabledReason(branch({ upstream: undefined, inSyncWithRemote: false }), gitStatus()))
      .toBe("No upstream remote branch is configured.");
  });

  it("matches branch filters from sync state", () => {
    expect(branchMatchesFilter(branch({ behind: 1 }), "behind")).toBe(true);
    expect(branchMatchesFilter(branch({ ahead: 1 }), "ahead")).toBe(true);
    expect(branchMatchesFilter(branch({ upstream: undefined }), "no-upstream")).toBe(true);
    expect(branchMatchesFilter(branch({ inSyncWithRemote: true }), "in-sync")).toBe(true);
    expect(branchMatchesFilter(branch({}), "all")).toBe(true);
  });
});
