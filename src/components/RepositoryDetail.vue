<script setup lang="ts">
import type { RepositoryDetails, RepositorySummary, ScriptTerminal } from '../repositories'
import NpmScriptsPanel from './NpmScriptsPanel.vue'

defineProps<{
  selectedDetails: RepositoryDetails | null
  selectedSummary?: RepositorySummary
  isDetailLoading: boolean
  autoRefreshLabel: string
  autoRefreshProgress: number
  npmScripts: [string, string][]
  scriptTerminalsByScript: Record<string, ScriptTerminal>
}>()

defineEmits<{
  back: []
  refresh: []
  runScript: [scriptName: string]
  stopScript: [scriptName: string]
}>()
</script>

<template>
  <section class="detail-view">
    <nav class="detail-nav" aria-label="Repository detail navigation">
      <button type="button" class="secondary" @click="$emit('back')">Back</button>
      <button
        type="button"
        class="secondary refresh-button"
        :disabled="isDetailLoading"
        :title="autoRefreshLabel"
        @click="$emit('refresh')"
      >
        <span class="refresh-button-label">Refresh</span>
        <span class="refresh-progress" aria-hidden="true">
          <span class="refresh-progress-fill" :style="{ width: `${autoRefreshProgress}%` }"></span>
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
          {{ selectedDetails.dirty ? 'Changes' : 'Clean' }}
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
          <strong>{{ selectedDetails.packageManager ?? 'none' }}</strong>
        </div>
      </div>

      <div class="detail-layout">
        <section class="detail-panel">
          <div class="panel-heading">
            <h3>Git log</h3>
          </div>
          <div v-if="selectedDetails.gitLog.length > 0" class="git-log-table-wrap">
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
          <pre>{{ selectedDetails.gitStatus }}</pre>
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
      {{ selectedSummary?.name ?? 'Repository' }} could not be loaded.
    </div>
  </section>
</template>
