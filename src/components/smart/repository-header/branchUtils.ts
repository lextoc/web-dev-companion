import type { RepositoryDetails } from "../../../repositories";

export type BranchFilterKey = "all" | "behind" | "ahead" | "no-upstream" | "in-sync";

export type SyncableBranch =
  | RepositoryDetails["gitBranches"][number]
  | RepositoryDetails["gitSubmodules"][number]["branches"][number];

export const branchFilters = [
  { key: "all", label: "All" },
  { key: "behind", label: "Behind" },
  { key: "ahead", label: "Ahead" },
  { key: "no-upstream", label: "No upstream" },
  { key: "in-sync", label: "In sync" },
] as const;

type BranchActionState = {
  checkingOutBranchName: string | null;
  checkingOutSubmoduleBranchName: string | null;
  deletingSubmoduleBranchName: string | null;
  mergingBranchName: string | null;
  mergingLinkedBranchName: string | null;
  syncingBranchName: string | null;
  syncingSubmoduleBranchName: string | null;
};

export function branchMatchesSearch(
  branch: RepositoryDetails["gitBranches"][number],
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return true;
  }

  return [branch.name, branch.upstream ?? ""].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

export function branchMatchesFilter(
  branch: RepositoryDetails["gitBranches"][number],
  filterKey: BranchFilterKey,
) {
  if (filterKey === "behind") {
    return branch.behind > 0;
  }

  if (filterKey === "ahead") {
    return branch.ahead > 0;
  }

  if (filterKey === "no-upstream") {
    return !branch.upstream;
  }

  if (filterKey === "in-sync") {
    return branch.inSyncWithRemote;
  }

  return true;
}

export function inferNextNumberedBranch(currentBranchName: string, branchNames: string[]) {
  const match = currentBranchName.match(/^(.*?)(\d+)$/);

  if (!match) {
    return "";
  }

  const [, prefix, numberText] = match;
  const nextNumber = String(Number(numberText) + 1).padStart(numberText.length, "0");
  const nextBranchName = `${prefix}${nextNumber}`;

  return branchNames.includes(nextBranchName) ? nextBranchName : "";
}

export function branchSyncLabel(branch: SyncableBranch) {
  if (!branch.upstream) {
    return "No upstream";
  }

  if (branch.inSyncWithRemote) {
    return "In sync";
  }

  if (branch.remoteGone) {
    return "Remote gone";
  }

  if (branch.ahead > 0 && branch.behind > 0) {
    return `${branch.ahead} ahead, ${branch.behind} behind`;
  }

  if (branch.ahead > 0) {
    return `${branch.ahead} ahead`;
  }

  return `${branch.behind} behind`;
}

export function branchSyncDisabledReason(
  branch: SyncableBranch,
  gitStatus: RepositoryDetails["gitStatus"],
) {
  if (hasStagedOrUnstagedChanges(gitStatus)) {
    return "Commit, stash, or discard staged and unstaged changes before syncing.";
  }

  return branchSyncMetadataDisabledReason(branch);
}

export function branchSyncMetadataDisabledReason(branch: SyncableBranch) {
  if (!branch.upstream) {
    return "No upstream remote branch is configured.";
  }

  if (branch.remoteGone) {
    return "Upstream remote branch is gone.";
  }

  if (branch.ahead > 0 && branch.behind > 0) {
    return "Branch has both local and remote commits. Resolve it manually before syncing.";
  }

  return undefined;
}

export function isSyncingBranch(branchName: string, syncingBranchName: string | null) {
  return syncingBranchName === branchName;
}

export function isSyncingSubmoduleBranch(
  syncingSubmoduleBranchName: string | null,
  submodulePath: string,
  branchName: string,
) {
  return syncingSubmoduleBranchName === branchActionKey(submodulePath, branchName);
}

export function isDeletingBranch(branchName: string, deletingBranchName: string | null) {
  return deletingBranchName === branchName;
}

export function isDeletingSubmoduleBranch(
  deletingSubmoduleBranchName: string | null,
  submodulePath: string,
  branchName: string,
) {
  return deletingSubmoduleBranchName === branchActionKey(submodulePath, branchName);
}

export function isCheckingOutBranch(branchName: string, checkingOutBranchName: string | null) {
  return checkingOutBranchName === branchName;
}

export function isCheckingOutSubmoduleBranch(
  checkingOutSubmoduleBranchName: string | null,
  submodulePath: string,
  branchName: string,
) {
  return checkingOutSubmoduleBranchName === branchActionKey(submodulePath, branchName);
}

export function isBranchSyncActionReady(
  branch: SyncableBranch,
  gitStatus: RepositoryDetails["gitStatus"],
) {
  return !branch.inSyncWithRemote && !branchSyncDisabledReason(branch, gitStatus);
}

export function isSubmoduleBranchSyncActionReady(
  submodule: RepositoryDetails["gitSubmodules"][number],
  branch: RepositoryDetails["gitSubmodules"][number]["branches"][number],
) {
  return !branch.inSyncWithRemote && !submoduleBranchSyncDisabledReason(submodule, branch);
}

export function branchCheckoutDisabledReason(gitStatus: RepositoryDetails["gitStatus"]) {
  return gitStatus.clean
    ? undefined
    : "Commit, stash, or discard working tree changes before switching branches.";
}

export function submoduleBranchCheckoutDisabledReason(
  submodule: RepositoryDetails["gitSubmodules"][number],
  actions: BranchActionState,
) {
  if (submodule.dirty) {
    return "Commit, stash, or discard submodule changes before switching branches.";
  }

  if (
    actions.checkingOutBranchName ||
    actions.checkingOutSubmoduleBranchName ||
    actions.syncingBranchName ||
    actions.syncingSubmoduleBranchName ||
    actions.deletingSubmoduleBranchName ||
    actions.mergingBranchName ||
    actions.mergingLinkedBranchName
  ) {
    return "Wait for the current branch action to finish.";
  }

  return "";
}

export function branchSyncTitle(
  branch: SyncableBranch,
  gitStatus: RepositoryDetails["gitStatus"],
  syncingBranchName: string | null,
) {
  if (isSyncingBranch(branch.name, syncingBranchName)) {
    return `Syncing ${branch.name}`;
  }

  return branchSyncDisabledReason(branch, gitStatus) ?? branchSyncActionTitle(branch);
}

export function submoduleBranchSyncTitle(
  submodule: RepositoryDetails["gitSubmodules"][number],
  branch: RepositoryDetails["gitSubmodules"][number]["branches"][number],
  syncingSubmoduleBranchName: string | null,
) {
  if (isSyncingSubmoduleBranch(syncingSubmoduleBranchName, submodule.path, branch.name)) {
    return `Syncing ${branch.name}`;
  }

  if (branch.inSyncWithRemote) {
    return "Branch is in sync with its remote.";
  }

  return submoduleBranchSyncDisabledReason(submodule, branch) ?? branchSyncActionTitle(branch);
}

export function submoduleBranchSyncDisabledReason(
  submodule: RepositoryDetails["gitSubmodules"][number],
  branch: RepositoryDetails["gitSubmodules"][number]["branches"][number],
) {
  if (submodule.dirty) {
    return "Commit, stash, or discard submodule changes before syncing.";
  }

  return branchSyncMetadataDisabledReason(branch);
}

export function branchSyncActionLabel(branch: SyncableBranch) {
  if (branch.ahead > 0 && branch.behind === 0) {
    return "Push";
  }

  if (branch.behind > 0 && branch.ahead === 0) {
    return "Pull";
  }

  return "Sync";
}

export function branchSyncActionIcon(
  branch: SyncableBranch,
  syncingBranchName: string | null,
) {
  if (isSyncingBranch(branch.name, syncingBranchName)) {
    return "restart";
  }

  if (branch.ahead > 0 && branch.behind === 0) {
    return "push";
  }

  if (branch.behind > 0 && branch.ahead === 0) {
    return "pull";
  }

  return "restart";
}

export function branchSyncActionTitle(branch: SyncableBranch) {
  if (branch.ahead > 0 && branch.behind === 0) {
    return "Push local commits to the upstream branch";
  }

  if (branch.behind > 0 && branch.ahead === 0) {
    return "Fast-forward the local branch from upstream";
  }

  return "Sync branch with upstream";
}

export function branchSafetyNotes(
  branch: RepositoryDetails["gitBranches"][number],
  gitStatus: RepositoryDetails["gitStatus"],
) {
  const notes = [];
  const syncReason = branchSyncDisabledReason(branch, gitStatus);

  if (syncReason && !branch.inSyncWithRemote) {
    notes.push(syncReason);
  }

  return [...new Set(notes)];
}

function hasStagedOrUnstagedChanges(gitStatus: RepositoryDetails["gitStatus"]) {
  return (
    gitStatus.staged.length > 0 ||
    gitStatus.unstaged.length > 0 ||
    gitStatus.conflicted.length > 0
  );
}

function branchActionKey(submodulePath: string, branchName: string) {
  return `${submodulePath}:${branchName}`;
}
