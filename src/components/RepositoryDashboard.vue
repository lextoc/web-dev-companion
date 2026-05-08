<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { RepositorySummary } from '../repositories'
import { AppDropdown, AppIcon } from './ui'
import RepositoryCard from './RepositoryCard.vue'

const props = defineProps<{
  repositories: RepositorySummary[]
  pinnedRepositoryPaths: string[]
  runningScriptsByRepositoryPath: Record<string, number>
  lastRefreshedLabel: string
  repoPathInput: string
  isLoading: boolean
  isRefreshing: boolean
}>()

defineEmits<{
  'update:repoPathInput': [value: string]
  add: []
  browse: []
  refresh: []
  open: [repository: RepositorySummary]
  remove: [repoPath: string]
  togglePin: [repoPath: string]
  copyPath: [repoPath: string]
  openInEditor: [repoPath: string]
  openInFileManager: [repoPath: string]
  openInTerminal: [repoPath: string]
}>()

const searchQuery = ref('')
const sortMode = ref<'dirty' | 'name' | 'scripts'>('dirty')
const isAddRepositoryOpen = ref(false)
const isRefreshIconSettling = ref(false)
const refreshButtonElement = ref<HTMLElement | null>(null)
const refreshIconStartAngle = ref(0)
const refreshIconEndAngle = ref(0)
const refreshIconSettleDuration = ref(0)
const pinnedRepositorySet = computed(() => new Set(props.pinnedRepositoryPaths))
let refreshIconSettleTimer: number | undefined
const sortOptions = [
  { label: 'Changes first', value: 'dirty' },
  { label: 'Name', value: 'name' },
  { label: 'Script count', value: 'scripts' },
]

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

      if (sortMode.value === 'scripts') {
        return repositoryB.npmScriptCount - repositoryA.npmScriptCount ||
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
              title="Refresh repositories"
              @click="$emit('refresh')"
            >
              <AppIcon name="restart" class="button-icon" />
              <span class="refresh-button-label">Refresh</span>
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
  </section>
</template>

<style scoped>
  .dashboard {
    display: grid;
    gap: 22px;
  }

  .add-repo {
    display: grid;
    gap: 9px;
    border: 0;
    border-radius: 8px;
    padding: 12px;
    background: var(--surface);
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
    grid-template-columns: minmax(180px, 240px) auto auto;
    align-items: end;
    gap: 12px;
  }

  .dashboard-toolbar span {
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

  .dashboard-add-toggle {
    min-height: 36px;
    padding: 0 13px;
    white-space: nowrap;
  }

  .dashboard-refresh-button {
    justify-self: end;
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
    gap: 16px;
  }

  .repo-section {
    display: grid;
    gap: 9px;
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
</style>
