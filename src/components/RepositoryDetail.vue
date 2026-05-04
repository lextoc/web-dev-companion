<script setup lang="ts">
import type {
  GitStatusEntry,
  RepositoryDetails,
  RepositorySummary,
  ScriptTerminal,
} from "../repositories";
import NpmScriptsPanel from "./NpmScriptsPanel.vue";

defineProps<{
  selectedDetails: RepositoryDetails | null;
  selectedSummary?: RepositorySummary;
  isDetailLoading: boolean;
  autoRefreshLabel: string;
  autoRefreshProgress: number;
  syncingBranchName: string | null;
  npmScripts: [string, string][];
  scriptTerminalsByScript: Record<string, ScriptTerminal>;
}>();

defineEmits<{
  back: [];
  refresh: [];
  deleteBranch: [branchName: string];
  syncBranch: [branchName: string];
  runScript: [scriptName: string];
  stopScript: [scriptName: string];
}>();

function statusGroups(gitStatus: RepositoryDetails["gitStatus"]) {
  return [
    { key: "conflicted", label: "Conflicts", entries: gitStatus.conflicted },
    { key: "staged", label: "Staged", entries: gitStatus.staged },
    { key: "unstaged", label: "Unstaged", entries: gitStatus.unstaged },
    { key: "untracked", label: "Untracked", entries: gitStatus.untracked },
  ];
}

function statusCode(entry: GitStatusEntry) {
  return `${entry.index}${entry.workingTree}`;
}

function branchSyncLabel(branch: RepositoryDetails["gitBranches"][number]) {
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

function hasStagedOrUnstagedChanges(gitStatus: RepositoryDetails["gitStatus"]) {
  return (
    gitStatus.staged.length > 0 ||
    gitStatus.unstaged.length > 0 ||
    gitStatus.conflicted.length > 0
  );
}

function branchSyncDisabledReason(
  branch: RepositoryDetails["gitBranches"][number],
  gitStatus: RepositoryDetails["gitStatus"],
) {
  if (hasStagedOrUnstagedChanges(gitStatus)) {
    return "Commit, stash, or discard staged and unstaged changes before syncing.";
  }

  if (!branch.upstream) {
    return "No upstream remote branch is configured.";
  }

  if (branch.remoteGone) {
    return "Upstream remote branch is gone.";
  }

  return undefined;
}

function isSyncingBranch(branchName: string, syncingBranchName: string | null) {
  return syncingBranchName === branchName;
}

function branchSyncTitle(
  branch: RepositoryDetails["gitBranches"][number],
  gitStatus: RepositoryDetails["gitStatus"],
  syncingBranchName: string | null,
) {
  if (isSyncingBranch(branch.name, syncingBranchName)) {
    return `Syncing ${branch.name}`;
  }

  return branchSyncDisabledReason(branch, gitStatus) ?? "Run git pull --ff-only";
}
</script>

<template>
  <section class="detail-view">
    <nav class="detail-nav" aria-label="Repository detail navigation">
      <button type="button" class="secondary" @click="$emit('back')">
        Back
      </button>
      <button
        type="button"
        class="secondary refresh-button"
        :disabled="isDetailLoading"
        :title="autoRefreshLabel"
        @click="$emit('refresh')"
      >
        <span class="refresh-button-label">Refresh</span>
        <span class="refresh-progress" aria-hidden="true">
          <span
            class="refresh-progress-fill"
            :style="{ width: `${autoRefreshProgress}%` }"
          ></span>
        </span>
      </button>
    </nav>

    <div v-if="isDetailLoading && !selectedDetails" class="empty-state">
      Loading repository...
    </div>

    <template v-else-if="selectedDetails">
      <header class="detail-header">
        <div>
          <p class="repo-path">{{ selectedDetails.path }}</p>
          <h2>{{ selectedDetails.name }}</h2>
        </div>
        <span class="status-pill" :class="{ dirty: selectedDetails.dirty }">
          {{ selectedDetails.dirty ? "Changes" : "Clean" }}
        </span>
      </header>

      <div class="summary-strip">
        <div>
          <span>Branch</span>
          <strong>{{ selectedDetails.branch }}</strong>
        </div>
        <div>
          <span>Latest</span>
          <strong>{{ selectedDetails.lastCommit }}</strong>
        </div>
        <div>
          <span>Package</span>
          <strong>{{ selectedDetails.packageManager ?? "none" }}</strong>
        </div>
      </div>

      <div class="detail-layout">
        <section class="detail-panel">
          <div class="panel-heading">
            <h3>Git log</h3>
          </div>
          <div
            v-if="selectedDetails.gitLog.length > 0"
            class="git-log-table-wrap"
          >
            <table class="git-log-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Author</th>
                  <th scope="col">Commit message</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in selectedDetails.gitLog" :key="entry.hash">
                  <td>
                    <time :datetime="entry.dateTime">{{ entry.time }}</time>
                  </td>
                  <td>
                    <strong>{{ entry.authorName }}</strong>
                    <small>{{ entry.authorEmail }}</small>
                  </td>
                  <td>{{ entry.message }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="empty-state compact-empty">
            No git log output available.
          </div>
        </section>

        <section class="detail-panel">
          <div class="panel-heading">
            <h3>Status</h3>
          </div>
          <div class="git-status-card">
            <div class="git-status-summary">
              <span>{{ selectedDetails.gitStatus.branch }}</span>
              <strong>
                {{
                  selectedDetails.gitStatus.clean
                    ? "Working tree clean"
                    : "Working tree has changes"
                }}
              </strong>
            </div>

            <section class="git-branches">
              <div class="git-status-group-heading">
                <h4>Local branches</h4>
                <span>{{ selectedDetails.gitBranches.length }}</span>
              </div>
              <p v-if="syncingBranchName" class="branch-pending">
                Syncing {{ syncingBranchName }}...
              </p>

              <ul v-if="selectedDetails.gitBranches.length > 0" class="git-branch-list">
                <li
                  v-for="branch in selectedDetails.gitBranches"
                  :key="branch.name"
                  :class="{ current: branch.current }"
                >
                  <div>
                    <strong>{{ branch.name }}</strong>
                    <small>
                      {{ branch.upstream ?? "No upstream" }}
                    </small>
                    <small v-if="branch.current">Current branch</small>
                  </div>
                  <span class="branch-sync" :class="{ synced: branch.inSyncWithRemote }">
                    {{ branchSyncLabel(branch) }}
                  </span>
                  <button
                    v-if="!branch.inSyncWithRemote"
                    type="button"
                    class="secondary branch-action"
                    :class="{ pending: isSyncingBranch(branch.name, syncingBranchName) }"
                    :disabled="
                      Boolean(branchSyncDisabledReason(branch, selectedDetails.gitStatus)) ||
                      isDetailLoading
                    "
                    :title="branchSyncTitle(branch, selectedDetails.gitStatus, syncingBranchName)"
                    :aria-busy="isSyncingBranch(branch.name, syncingBranchName)"
                    @click="$emit('syncBranch', branch.name)"
                  >
                    {{ isSyncingBranch(branch.name, syncingBranchName) ? "Syncing..." : "Sync" }}
                  </button>
                  <button
                    type="button"
                    class="secondary branch-action"
                    :disabled="!branch.canDelete || isDetailLoading"
                    :title="branch.deleteReason ?? 'Delete local branch'"
                    @click="$emit('deleteBranch', branch.name)"
                  >
                    Remove
                  </button>
                </li>
              </ul>

              <p v-else>No local branches found.</p>
            </section>

            <div v-if="selectedDetails.gitStatus.clean" class="empty-state compact-empty">
              No staged, unstaged, or untracked changes.
            </div>

            <div v-else class="git-status-groups">
              <section
                v-for="group in statusGroups(selectedDetails.gitStatus)"
                :key="group.key"
                class="git-status-group"
                :class="{ empty: group.entries.length === 0 }"
              >
                <div class="git-status-group-heading">
                  <h4>{{ group.label }}</h4>
                  <span>{{ group.entries.length }}</span>
                </div>

                <ul v-if="group.entries.length > 0" class="git-status-list">
                  <li v-for="entry in group.entries" :key="`${group.key}-${entry.path}`">
                    <code>{{ statusCode(entry) }}</code>
                    <div>
                      <strong>{{ entry.path }}</strong>
                      <small v-if="entry.originalPath">
                        from {{ entry.originalPath }}
                      </small>
                      <small>{{ entry.label }}</small>
                    </div>
                  </li>
                </ul>

                <p v-else>No {{ group.label.toLowerCase() }} changes.</p>
              </section>
            </div>
          </div>
        </section>

        <NpmScriptsPanel
          :npm-scripts="npmScripts"
          :script-terminals-by-script="scriptTerminalsByScript"
          @run="$emit('runScript', $event)"
          @stop="$emit('stopScript', $event)"
        />

        <section class="detail-panel">
          <div class="panel-heading">
            <h3>Remotes</h3>
          </div>
          <pre>{{ selectedDetails.remotes }}</pre>
        </section>
      </div>
    </template>

    <div v-else class="empty-state">
      {{ selectedSummary?.name ?? "Repository" }} could not be loaded.
    </div>
  </section>
</template>
