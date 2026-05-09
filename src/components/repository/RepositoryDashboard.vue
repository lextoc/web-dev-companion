<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { GitHubRepositorySummary, RepositorySummary } from '../../repositories'
import { AppDropdown, AppIcon } from '../ui'
import RepositoryCard from './RepositoryCard.vue'

const props = defineProps<{
  repositories: RepositorySummary[]
  localRepositoryCandidates: RepositorySummary[]
  githubRepositories: GitHubRepositorySummary[]
  pinnedRepositoryPaths: string[]
  runningScriptsByRepositoryPath: Record<string, number>
  lastRefreshedLabel: string
  autoRefreshLabel: string
  autoRefreshProgress: number
  repoPathInput: string
  isLoading: boolean
  isRefreshing: boolean
  isScanningLocalRepositories: boolean
  hasScannedLocalRepositories: boolean
  localRepositoryScanError: string
  isLoadingGitHubRepositories: boolean
  hasLoadedGitHubRepositories: boolean
  cloningGitHubRepositoryName: string
  githubRepositoriesError: string
}>()

defineEmits<{
  'update:repoPathInput': [value: string]
  add: []
  browse: []
  refresh: []
  scanLocalRepositories: []
  addScannedLocalRepository: [repoPath: string]
  loadGitHubRepositories: []
  cloneGitHubRepository: [nameWithOwner: string]
  open: [repository: RepositorySummary]
  remove: [repoPath: string]
  togglePin: [repoPath: string]
  copyPath: [repoPath: string]
  openInEditor: [repoPath: string]
  openInFileManager: [repoPath: string]
  openInTerminal: [repoPath: string]
}>()

const searchQuery = ref('')
const sortMode = ref<'dirty' | 'name' | 'tasks'>('dirty')
const isAddRepositoryOpen = ref(false)
const isRefreshIconSettling = ref(false)
const refreshButtonElement = ref<HTMLElement | null>(null)
const refreshIconStartAngle = ref(0)
const refreshIconEndAngle = ref(0)
const refreshIconSettleDuration = ref(0)
const pinnedRepositorySet = computed(() => new Set(props.pinnedRepositoryPaths))
const savedRepositoryPathSet = computed(() => new Set(props.repositories.map((repository) => repositoryPathKey(repository.path))))
const filteredLocalRepositoryCandidates = computed(() =>
  props.localRepositoryCandidates.filter((repository) => !savedRepositoryPathSet.value.has(repositoryPathKey(repository.path))),
)
const savedGitHubRepositorySet = computed(() => {
  const keys = props.repositories.flatMap((repository) => {
    const remoteKey = repository.remote ? githubRepositoryKeyFromUrl(repository.remote) : undefined
    return remoteKey ? [remoteKey] : []
  })

  return new Set(keys)
})
let refreshIconSettleTimer: number | undefined
const sortOptions = [
  { label: 'Changes first', value: 'dirty' },
  { label: 'Name', value: 'name' },
  { label: 'Task count', value: 'tasks' },
]

function repositoryPathKey(repoPath: string) {
  return navigator.platform.toLowerCase().includes('win') ? repoPath.toLowerCase() : repoPath
}

function githubRepositoryKeyFromUrl(value: string) {
  const normalizedValue = value.trim().replace(/\.git\/?$/, '').replace(/\/+$/, '')

  if (!normalizedValue) {
    return undefined
  }

  if (/^https?:\/\//i.test(normalizedValue)) {
    try {
      const parsedUrl = new URL(normalizedValue)

      if (!parsedUrl.hostname.toLowerCase().endsWith('github.com')) {
        return undefined
      }

      const [owner, repo] = parsedUrl.pathname.replace(/^\/+/, '').split('/')

      return owner && repo ? `${owner}/${repo}`.toLowerCase() : undefined
    } catch {
      return undefined
    }
  }

  const scpLikeMatch = normalizedValue.match(/^(?:[^@]+@)?github\.com:(.+)$/i)

  if (!scpLikeMatch) {
    return undefined
  }

  const [owner, repo] = scpLikeMatch[1].split('/')

  return owner && repo ? `${owner}/${repo}`.toLowerCase() : undefined
}

function isGitHubRepositorySaved(repository: GitHubRepositorySummary) {
  return savedGitHubRepositorySet.value.has(repository.nameWithOwner.toLowerCase())
}

function updatedLabel(updatedAt: string | undefined) {
  if (!updatedAt) {
    return ''
  }

  const updatedDate = new Date(updatedAt)

  if (Number.isNaN(updatedDate.getTime())) {
    return ''
  }

  return `Updated ${updatedDate.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: updatedDate.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })}`
}

const filteredRepositories = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()

  return [...props.repositories]
    .filter((repository) => {
      if (!query) {
        return true
      }

      return [repository.name, repository.path, repository.branch, repository.remote ?? '']
        .some((value) => value.toLowerCase().includes(query))
    })
    .sort((repositoryA, repositoryB) => {
      const pinnedComparison =
        Number(pinnedRepositorySet.value.has(repositoryB.path)) -
        Number(pinnedRepositorySet.value.has(repositoryA.path))

      if (pinnedComparison !== 0) {
        return pinnedComparison
      }

      if (sortMode.value === 'name') {
        return repositoryA.name.localeCompare(repositoryB.name)
      }

      if (sortMode.value === 'tasks') {
        return repositoryB.taskCount - repositoryA.taskCount ||
          repositoryA.name.localeCompare(repositoryB.name)
      }

      return Number(repositoryB.dirty) - Number(repositoryA.dirty) ||
        repositoryA.name.localeCompare(repositoryB.name)
    })
})

const repositorySections = computed(() => {
  const pinnedRepositories = filteredRepositories.value.filter((repository) =>
    pinnedRepositorySet.value.has(repository.path),
  )
  const regularRepositories = filteredRepositories.value.filter((repository) =>
    !pinnedRepositorySet.value.has(repository.path),
  )

  return [
    {
      key: 'pinned',
      title: 'Pinned repositories',
      count: pinnedRepositories.length,
      repositories: pinnedRepositories,
    },
    {
      key: 'all',
      title: pinnedRepositories.length > 0 ? 'Other repositories' : 'Repositories',
      count: regularRepositories.length,
      repositories: regularRepositories,
    },
  ].filter((section) => section.repositories.length > 0)
})

function currentRefreshIconAngle() {
  const iconElement = refreshButtonElement.value?.querySelector<HTMLElement>('.button-icon')

  if (!iconElement) {
    return 0
  }

  const transform = window.getComputedStyle(iconElement).transform

  if (!transform || transform === 'none') {
    return 0
  }

  const matrix = new DOMMatrixReadOnly(transform)
  const angle = Math.atan2(matrix.b, matrix.a) * (180 / Math.PI)

  return (angle + 360) % 360
}

function prepareRefreshIconSettle() {
  const startAngle = currentRefreshIconAngle()
  const remainingAngle = startAngle === 0 ? 0 : 360 - startAngle

  refreshIconStartAngle.value = startAngle
  refreshIconEndAngle.value = remainingAngle === 0 ? 0 : 360
  refreshIconSettleDuration.value = Math.round((remainingAngle / 360) * 900)
}

watch(
  () => props.isRefreshing,
  (isRefreshing, wasRefreshing) => {
    if (refreshIconSettleTimer !== undefined) {
      window.clearTimeout(refreshIconSettleTimer)
      refreshIconSettleTimer = undefined
    }

    if (isRefreshing) {
      isRefreshIconSettling.value = false
      return
    }

    if (wasRefreshing) {
      prepareRefreshIconSettle()
      isRefreshIconSettling.value = true
      refreshIconSettleTimer = window.setTimeout(() => {
        isRefreshIconSettling.value = false
        refreshIconSettleTimer = undefined
      }, refreshIconSettleDuration.value)
    }
  },
)

onBeforeUnmount(() => {
  if (refreshIconSettleTimer !== undefined) {
    window.clearTimeout(refreshIconSettleTimer)
  }
})
</script>

<template>
  <section class="dashboard">
    <div v-if="isLoading && repositories.length === 0" class="repo-skeleton-grid" aria-label="Loading repositories">
      <article v-for="index in 6" :key="index" class="repo-card skeleton-card">
        <span></span>
        <span></span>
        <span></span>
      </article>
    </div>

    <div v-else-if="repositories.length === 0" class="empty-state">
      <strong>No repositories saved.</strong>
      <span>Add a path manually or browse to a repository folder.</span>
      <form class="add-repo empty-add-repo" @submit.prevent="$emit('add')">
        <label for="empty-repo-path">Repository path</label>
        <div class="add-row">
          <input
            id="empty-repo-path"
            :value="repoPathInput"
            type="text"
            placeholder="Path to repository folder"
            autocomplete="off"
            @input="$emit('update:repoPathInput', ($event.target as HTMLInputElement).value)"
          />
          <button type="submit" :disabled="isLoading">Add</button>
          <button type="button" class="secondary" :disabled="isLoading" @click="$emit('browse')">
            Browse
          </button>
        </div>
      </form>
    </div>

    <template v-else>
      <div class="dashboard-repositories">
        <div class="dashboard-toolbar">
          <label class="dashboard-search-control">
            <span>Search repositories</span>
            <input
              v-model="searchQuery"
              type="search"
              placeholder="Repository, branch, or path"
              autocomplete="off"
            />
          </label>

          <div class="dashboard-toolbar-actions">
            <label class="dashboard-sort-control">
              <span>Sort</span>
              <AppDropdown
                id="dashboard-sort"
                v-model="sortMode"
                :options="sortOptions"
              />
            </label>
            <button
              ref="refreshButtonElement"
              type="button"
              class="secondary refresh-button dashboard-refresh-button"
              :class="{ pending: isRefreshing, settling: isRefreshIconSettling }"
              :style="{
                '--refresh-start-angle': `${refreshIconStartAngle}deg`,
                '--refresh-end-angle': `${refreshIconEndAngle}deg`,
                '--refresh-settle-duration': `${refreshIconSettleDuration}ms`,
              }"
              :disabled="isLoading"
              :aria-busy="isRefreshing"
              :aria-label="isRefreshing ? 'Refreshing repositories' : 'Refresh repositories'"
              :title="isRefreshing ? 'Refreshing repositories' : autoRefreshLabel"
              @click="$emit('refresh')"
            >
              <AppIcon name="restart" class="button-icon" />
              <span class="refresh-button-label">Refresh</span>
              <span class="refresh-progress" aria-hidden="true">
                <span
                  class="refresh-progress-fill"
                  :style="{ width: `${autoRefreshProgress}%` }"
                ></span>
              </span>
            </button>
            <button
              type="button"
              class="secondary dashboard-add-toggle"
              :class="{ active: isAddRepositoryOpen }"
              :aria-expanded="isAddRepositoryOpen"
              @click="isAddRepositoryOpen = !isAddRepositoryOpen"
            >
              Add repository
            </button>
          </div>
        </div>

        <form v-if="isAddRepositoryOpen" class="add-repo" @submit.prevent="$emit('add')">
          <label for="repo-path">Repository path</label>
          <div class="add-row">
            <input
              id="repo-path"
              :value="repoPathInput"
              type="text"
              placeholder="Path to repository folder"
              autocomplete="off"
              @input="$emit('update:repoPathInput', ($event.target as HTMLInputElement).value)"
            />
            <button type="submit" :disabled="isLoading">Add</button>
            <button type="button" class="secondary" :disabled="isLoading" @click="$emit('browse')">
              Browse
            </button>
          </div>
        </form>

        <div v-if="filteredRepositories.length === 0" class="empty-state">
          No repositories match this filter.
        </div>

        <div v-else class="repo-sections">
          <section
            v-for="section in repositorySections"
            :key="section.key"
            class="repo-section"
          >
            <div class="repo-section-heading">
              <h2>{{ section.title }}</h2>
              <span>{{ section.count }}</span>
            </div>

            <div class="repo-grid">
              <RepositoryCard
                v-for="repository in section.repositories"
                :key="repository.path"
                :repository="repository"
                :is-pinned="pinnedRepositorySet.has(repository.path)"
                :running-script-count="runningScriptsByRepositoryPath[repository.path] ?? 0"
                :last-refreshed-label="lastRefreshedLabel"
                @open="$emit('open', $event)"
                @remove="$emit('remove', $event)"
                @toggle-pin="$emit('togglePin', $event)"
                @copy-path="$emit('copyPath', $event)"
                @open-in-editor="$emit('openInEditor', $event)"
                @open-in-file-manager="$emit('openInFileManager', $event)"
                @open-in-terminal="$emit('openInTerminal', $event)"
              />
            </div>
          </section>
        </div>
      </div>
    </template>

    <section class="local-repositories">
      <div class="local-section-heading">
        <div>
          <h2>Local repositories not added yet</h2>
          <span v-if="filteredLocalRepositoryCandidates.length > 0">
            {{ filteredLocalRepositoryCandidates.length }}
          </span>
        </div>
        <button
          type="button"
          class="secondary local-scan-button"
          :disabled="isScanningLocalRepositories"
          @click="$emit('scanLocalRepositories')"
        >
          <AppIcon name="folder" class="button-icon" />
          {{ hasScannedLocalRepositories ? 'Scan again' : 'Scan folder' }}
        </button>
      </div>

      <div
        v-if="isScanningLocalRepositories && filteredLocalRepositoryCandidates.length === 0"
        class="local-repo-grid"
        aria-label="Scanning local repositories"
      >
        <article v-for="index in 3" :key="index" class="local-repo-card local-skeleton-card">
          <span></span>
          <span></span>
          <span></span>
        </article>
      </div>

      <div
        v-else-if="filteredLocalRepositoryCandidates.length === 0"
        class="local-empty-state"
        :class="{ error: localRepositoryScanError }"
      >
        <strong v-if="localRepositoryScanError">Local scan failed.</strong>
        <span>
          {{
            localRepositoryScanError ||
            (hasScannedLocalRepositories
              ? 'No untracked local repositories found in that folder.'
              : 'Scan a parent folder to find cloned projects that are not saved yet.')
          }}
        </span>
      </div>

      <div v-else class="local-repo-grid">
        <article
          v-for="repository in filteredLocalRepositoryCandidates"
          :key="repository.path"
          class="local-repo-card"
        >
          <div class="local-repo-main">
            <div class="local-repo-title-row">
              <strong :title="repository.name">{{ repository.name }}</strong>
              <span class="local-branch-pill" :title="repository.branch">{{ repository.branch }}</span>
            </div>
            <p :title="repository.path">{{ repository.path }}</p>
            <div class="local-repo-meta">
              <span :class="{ dirty: repository.dirty }">{{ repository.dirty ? 'Changes' : 'Clean' }}</span>
              <span>{{ repository.taskCount }} tasks</span>
              <span v-if="repository.remote" :title="repository.remote">Remote</span>
            </div>
          </div>
          <button
            type="button"
            class="local-add-button"
            :disabled="isLoading"
            @click="$emit('addScannedLocalRepository', repository.path)"
          >
            <AppIcon name="repository" class="button-icon" />
            Add
          </button>
        </article>
      </div>
    </section>

    <section class="github-repositories">
      <div class="github-section-heading">
        <div>
          <h2>GitHub repositories</h2>
          <span v-if="githubRepositories.length > 0">{{ githubRepositories.length }}</span>
        </div>
        <button
          type="button"
          class="secondary github-refresh-button"
          :disabled="isLoadingGitHubRepositories"
          @click="$emit('loadGitHubRepositories')"
        >
          <AppIcon name="restart" class="button-icon" />
          {{ hasLoadedGitHubRepositories ? 'Refresh GitHub' : 'Load GitHub' }}
        </button>
      </div>

      <div
        v-if="isLoadingGitHubRepositories && githubRepositories.length === 0"
        class="github-repo-grid"
        aria-label="Loading GitHub repositories"
      >
        <article v-for="index in 3" :key="index" class="github-repo-card github-skeleton-card">
          <span></span>
          <span></span>
          <span></span>
        </article>
      </div>

      <div
        v-else-if="githubRepositories.length === 0"
        class="github-empty-state"
        :class="{ error: githubRepositoriesError }"
      >
        <strong v-if="githubRepositoriesError">GitHub setup needed.</strong>
        <span>{{ githubRepositoriesError || 'Load repositories from your GitHub account through the GitHub CLI.' }}</span>
      </div>

      <div v-else class="github-repo-grid">
        <article
          v-for="repository in githubRepositories"
          :key="repository.nameWithOwner"
          class="github-repo-card"
        >
          <div class="github-repo-main">
            <div class="github-repo-title-row">
              <strong :title="repository.nameWithOwner">{{ repository.nameWithOwner }}</strong>
              <span class="github-visibility-pill">{{ repository.isPrivate ? 'Private' : 'Public' }}</span>
            </div>
            <p :title="repository.description || repository.url">
              {{ repository.description || repository.url }}
            </p>
            <div class="github-repo-meta">
              <span v-if="repository.primaryLanguage">{{ repository.primaryLanguage }}</span>
              <span v-if="repository.isFork">Fork</span>
              <span v-if="updatedLabel(repository.updatedAt)">{{ updatedLabel(repository.updatedAt) }}</span>
            </div>
          </div>
          <button
            type="button"
            class="github-clone-button"
            :disabled="
              isLoading ||
              isGitHubRepositorySaved(repository) ||
              cloningGitHubRepositoryName === repository.nameWithOwner
            "
            @click="$emit('cloneGitHubRepository', repository.nameWithOwner)"
          >
            <AppIcon name="pull" class="button-icon" />
            <span v-if="isGitHubRepositorySaved(repository)">Saved</span>
            <span v-else-if="cloningGitHubRepositoryName === repository.nameWithOwner">Cloning</span>
            <span v-else>Clone</span>
          </button>
        </article>
      </div>
    </section>
  </section>
</template>

<style scoped>
  .dashboard {
    display: grid;
    gap: 16px;
  }

  .add-repo {
    display: grid;
    gap: 9px;
    border: 0;
    border-radius: 8px;
    padding: 12px;
    background: color-mix(in srgb, var(--surface) 68%, var(--app-bg));
    box-shadow: none;
  }

  .empty-add-repo {
    width: min(860px, 100%);
    box-shadow: none;
  }

  .add-repo label {
    color: var(--muted-strong);
    font-size: var(--font-size-compact);
    font-weight: 800;
    text-transform: uppercase;
  }

  .add-row {
    gap: 10px;
  }

  .add-row input {
    width: 100%;
    min-height: 42px;
    border: 1px solid var(--border-control);
    border-radius: 7px;
    padding: 0 12px;
    background: var(--surface);
    color: var(--text);
  }

  .dashboard-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: end;
    border: 0;
    border-radius: 8px;
    padding: 0;
    background: transparent;
  }

  .dashboard-toolbar label,
  .dashboard-toolbar-actions {
    display: grid;
    gap: 6px;
  }

  .dashboard-toolbar-actions {
    grid-template-columns: minmax(160px, 200px) auto auto;
    align-items: end;
    gap: 12px;
  }

  .dashboard-toolbar label > span {
    color: var(--muted-strong);
    font-size: var(--font-size-compact);
    font-weight: 900;
    text-transform: uppercase;
  }

  .dashboard-toolbar input {
    width: 100%;
    min-height: 36px;
    border: 1px solid var(--border-control);
    border-radius: 7px;
    padding: 0 12px;
    background: var(--surface);
    color: var(--text);
    font-size: var(--font-size-base);
  }

  .dashboard-toolbar .app-dropdown {
    width: 100%;
  }

  .dashboard-sort-control :deep(.app-dropdown-button) {
    min-height: 36px;
    padding: 0 9px 0 12px;
  }

  @media (max-width: 1280px) {
    .dashboard-toolbar {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .add-row {
      align-items: stretch;
      flex-direction: column;
    }

    .dashboard-toolbar {
      grid-template-columns: 1fr;
    }

    .dashboard-toolbar-actions {
      grid-template-columns: 1fr;
    }

    .local-section-heading,
    .local-repo-card,
    .github-section-heading,
    .github-repo-card {
      align-items: stretch;
      grid-template-columns: 1fr;
    }

    .local-section-heading,
    .github-section-heading {
      display: grid;
    }

    .local-scan-button,
    .local-add-button,
    .github-refresh-button,
    .github-clone-button {
      width: 100%;
    }
  }

  .dashboard-add-toggle {
    min-height: 36px;
    padding: 0 13px;
    white-space: nowrap;
  }

  .dashboard-refresh-button {
    justify-self: end;
    padding: 0 12px;
  }

  .refresh-button {
    display: inline-flex;
    position: relative;
    overflow: hidden;
    min-height: 36px;
    align-items: center;
    gap: 7px;
    padding: 0 12px 4px;
  }

  .refresh-button :deep(.button-icon) {
    position: relative;
    z-index: 1;
    width: 15px;
    height: 15px;
    transform-origin: center;
    transition: opacity 180ms ease;
  }

  .refresh-button-label {
    position: relative;
    z-index: 1;
    line-height: 1;
  }

  .refresh-progress {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 3px;
    border-radius: 999px;
    background: var(--border-soft);
  }

  .refresh-progress-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--brand);
    transition: width 250ms linear;
  }

  .refresh-button:hover:not(:disabled) .refresh-progress-fill {
    background: var(--brand-hover);
  }

  .refresh-button.pending :deep(.button-icon) {
    animation: refresh-spin 900ms linear infinite;
  }

  .refresh-button.settling :deep(.button-icon) {
    animation: refresh-settle var(--refresh-settle-duration, 220ms) linear
      forwards;
  }

  .dashboard-add-toggle.active {
    border-color: var(--brand);
    background: var(--surface-hover);
    color: var(--brand-text-hover);
  }

  .dashboard-repositories {
    display: grid;
    min-width: 0;
    gap: 18px;
  }

  .empty-state {
    display: grid;
    justify-items: center;
    gap: 10px;
    border: 0;
    border-radius: 8px;
    padding: 40px 20px;
    color: var(--muted);
    text-align: center;
  }

  .empty-state strong {
    color: var(--text);
  }

  .empty-state span {
    max-width: 520px;
  }

  .repo-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .repo-sections {
    display: grid;
    gap: 14px;
  }

  .repo-section {
    display: grid;
    gap: 9px;
  }

  .local-repositories {
    display: grid;
    gap: 10px;
    padding-top: 4px;
  }

  .local-section-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 12px;
  }

  .local-section-heading > div {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .local-section-heading h2 {
    margin: 0;
    color: var(--muted-strong);
    font-size: var(--font-size-base);
    font-weight: 900;
    text-transform: uppercase;
  }

  .local-section-heading span {
    display: grid;
    min-width: 24px;
    height: 24px;
    place-items: center;
    border-radius: 999px;
    background: var(--surface-subtle);
    color: var(--muted-strong);
    font-size: var(--font-size-compact);
    font-weight: 900;
  }

  .local-scan-button,
  .local-add-button {
    display: inline-flex;
    min-height: 36px;
    align-items: center;
    justify-content: center;
    gap: 7px;
    white-space: nowrap;
  }

  .local-scan-button,
  .local-add-button {
    padding: 0 12px;
  }

  .local-scan-button .button-icon,
  .local-add-button .button-icon {
    width: 15px;
    height: 15px;
  }

  .local-repo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }

  .local-repo-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    min-height: 116px;
    border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
    border-radius: 8px;
    padding: 12px;
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--surface) 90%, var(--app-bg)),
        color-mix(in srgb, var(--surface-soft) 46%, var(--surface))
      );
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, #fff 42%, transparent),
      0 1px 2px rgba(23, 32, 42, 0.08);
  }

  .local-repo-main {
    display: grid;
    min-width: 0;
    gap: 7px;
  }

  .local-repo-title-row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  .local-repo-title-row strong,
  .local-repo-main p {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .local-repo-title-row strong {
    color: var(--text);
    font-size: var(--font-size-base);
    font-weight: 900;
  }

  .local-branch-pill,
  .local-repo-meta span {
    display: inline-flex;
    align-items: center;
    min-height: 22px;
    border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
    border-radius: 999px;
    padding: 0 8px;
    background: color-mix(in srgb, var(--surface-subtle) 58%, var(--surface));
    color: var(--muted-strong);
    font-size: 0.72rem;
    font-weight: 720;
    white-space: nowrap;
  }

  .local-repo-meta span.dirty {
    border-color: color-mix(in srgb, var(--warning-text) 24%, transparent);
    background: color-mix(in srgb, var(--warning-soft) 72%, var(--surface));
    color: var(--warning-text);
  }

  .local-repo-main p {
    margin: 0;
    color: var(--muted-strong);
    font-size: var(--font-size-compact);
  }

  .local-repo-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .local-empty-state {
    display: grid;
    min-height: 78px;
    gap: 6px;
    place-items: center;
    border: 1px dashed color-mix(in srgb, var(--border) 72%, transparent);
    border-radius: 8px;
    padding: 14px;
    color: var(--muted);
    text-align: center;
  }

  .local-empty-state strong {
    color: var(--text);
  }

  .local-empty-state span {
    max-width: 680px;
    overflow-wrap: anywhere;
  }

  .local-empty-state.error {
    border-color: color-mix(in srgb, var(--warning-text) 36%, transparent);
    background: color-mix(in srgb, var(--warning-soft) 24%, transparent);
    color: var(--muted-strong);
  }

  .local-skeleton-card {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .local-skeleton-card span {
    display: block;
    height: 13px;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      var(--surface-subtle),
      var(--surface-soft),
      var(--surface-subtle)
    );
    background-size: 220% 100%;
    animation: skeleton-shimmer 1.4s ease-in-out infinite;
  }

  .local-skeleton-card span:first-child {
    width: 68%;
  }

  .local-skeleton-card span:nth-child(2) {
    width: 92%;
  }

  .local-skeleton-card span:nth-child(3) {
    width: 48%;
  }

  .github-repositories {
    display: grid;
    gap: 10px;
    padding-top: 4px;
  }

  .github-section-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 12px;
  }

  .github-section-heading > div {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .github-section-heading h2 {
    margin: 0;
    color: var(--muted-strong);
    font-size: var(--font-size-base);
    font-weight: 900;
    text-transform: uppercase;
  }

  .github-section-heading span {
    display: grid;
    min-width: 24px;
    height: 24px;
    place-items: center;
    border-radius: 999px;
    background: var(--surface-subtle);
    color: var(--muted-strong);
    font-size: var(--font-size-compact);
    font-weight: 900;
  }

  .github-refresh-button,
  .github-clone-button {
    display: inline-flex;
    min-height: 36px;
    align-items: center;
    justify-content: center;
    gap: 7px;
    white-space: nowrap;
  }

  .github-refresh-button {
    padding: 0 12px;
  }

  .github-refresh-button .button-icon,
  .github-clone-button .button-icon {
    width: 15px;
    height: 15px;
  }

  .github-repo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }

  .github-repo-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    min-height: 116px;
    border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
    border-radius: 8px;
    padding: 12px;
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--surface) 90%, var(--app-bg)),
        color-mix(in srgb, var(--surface-soft) 46%, var(--surface))
      );
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, #fff 42%, transparent),
      0 1px 2px rgba(23, 32, 42, 0.08);
  }

  .github-repo-main {
    display: grid;
    min-width: 0;
    gap: 7px;
  }

  .github-repo-title-row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  .github-repo-title-row strong,
  .github-repo-main p {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .github-repo-title-row strong {
    color: var(--text);
    font-size: var(--font-size-base);
    font-weight: 900;
  }

  .github-visibility-pill,
  .github-repo-meta span {
    display: inline-flex;
    align-items: center;
    min-height: 22px;
    border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
    border-radius: 999px;
    padding: 0 8px;
    background: color-mix(in srgb, var(--surface-subtle) 58%, var(--surface));
    color: var(--muted-strong);
    font-size: 0.72rem;
    font-weight: 720;
    white-space: nowrap;
  }

  .github-repo-main p {
    margin: 0;
    color: var(--muted-strong);
    font-size: var(--font-size-compact);
  }

  .github-repo-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .github-clone-button {
    padding: 0 12px;
  }

  .github-empty-state {
    display: grid;
    min-height: 78px;
    gap: 6px;
    place-items: center;
    border: 1px dashed color-mix(in srgb, var(--border) 72%, transparent);
    border-radius: 8px;
    padding: 14px;
    color: var(--muted);
    text-align: center;
  }

  .github-empty-state strong {
    color: var(--text);
  }

  .github-empty-state span {
    max-width: 680px;
    overflow-wrap: anywhere;
  }

  .github-empty-state.error {
    border-color: color-mix(in srgb, var(--warning-text) 36%, transparent);
    background: color-mix(in srgb, var(--warning-soft) 24%, transparent);
    color: var(--muted-strong);
  }

  .github-skeleton-card {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .github-skeleton-card span {
    display: block;
    height: 13px;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      var(--surface-subtle),
      var(--surface-soft),
      var(--surface-subtle)
    );
    background-size: 220% 100%;
    animation: skeleton-shimmer 1.4s ease-in-out infinite;
  }

  .github-skeleton-card span:first-child {
    width: 68%;
  }

  .github-skeleton-card span:nth-child(2) {
    width: 92%;
  }

  .github-skeleton-card span:nth-child(3) {
    width: 48%;
  }

  .repo-section-heading {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .repo-section-heading h2 {
    margin: 0;
    color: var(--muted-strong);
    font-size: var(--font-size-base);
    font-weight: 900;
    text-transform: uppercase;
  }

  .repo-section-heading span {
    display: grid;
    min-width: 24px;
    height: 24px;
    place-items: center;
    border-radius: 999px;
    background: var(--surface-subtle);
    color: var(--muted-strong);
    font-size: var(--font-size-compact);
    font-weight: 900;
  }

  .repo-skeleton-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }

  .repo-card {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
    border-radius: 8px;
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--surface) 94%, #fff),
        color-mix(in srgb, var(--surface-soft) 34%, var(--surface))
      );
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, #fff 56%, transparent),
      0 1px 2px rgba(23, 32, 42, 0.08);
  }

  .skeleton-card {
    display: grid;
    gap: 12px;
    min-height: 196px;
    overflow: hidden;
    padding: 18px;
  }

  .skeleton-card span {
    display: block;
    height: 14px;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      var(--surface-subtle),
      var(--surface-soft),
      var(--surface-subtle)
    );
    background-size: 220% 100%;
    animation: skeleton-shimmer 1.4s ease-in-out infinite;
  }

  .skeleton-card span:first-child {
    width: 55%;
  }

  .skeleton-card span:nth-child(2) {
    width: 82%;
  }

  .skeleton-card span:nth-child(3) {
    width: 66%;
  }

  @keyframes skeleton-shimmer {
    0% {
      background-position: 120% 0;
    }

    100% {
      background-position: -120% 0;
    }
  }

  @keyframes refresh-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes refresh-settle {
    from {
      transform: rotate(var(--refresh-start-angle, 0deg));
    }

    to {
      transform: rotate(var(--refresh-end-angle, 0deg));
    }
  }
</style>
