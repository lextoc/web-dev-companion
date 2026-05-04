<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RepositorySummary } from '../repositories'
import RepositoryCard from './RepositoryCard.vue'

const props = defineProps<{
  repositories: RepositorySummary[]
  pinnedRepositoryPaths: string[]
  runningScriptsByRepositoryPath: Record<string, number>
  lastRefreshedLabel: string
  repoPathInput: string
  isLoading: boolean
}>()

defineEmits<{
  'update:repoPathInput': [value: string]
  add: []
  browse: []
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
const pinnedRepositorySet = computed(() => new Set(props.pinnedRepositoryPaths))

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
</script>

<template>
  <section class="dashboard">
    <form class="add-repo" @submit.prevent="$emit('add')">
      <label for="repo-path">Repository path</label>
      <div class="add-row">
        <input
          id="repo-path"
          :value="repoPathInput"
          type="text"
          placeholder="/Users/alexanderclaes/project"
          autocomplete="off"
          @input="$emit('update:repoPathInput', ($event.target as HTMLInputElement).value)"
        />
        <button type="submit" :disabled="isLoading">Add</button>
        <button type="button" class="secondary" :disabled="isLoading" @click="$emit('browse')">
          Browse
        </button>
      </div>
    </form>

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
      <button type="button" class="secondary" :disabled="isLoading" @click="$emit('browse')">
        Browse for repository
      </button>
    </div>

    <template v-else>
      <div class="dashboard-toolbar">
        <label>
          <span>Search</span>
          <input
            v-model="searchQuery"
            type="search"
            placeholder="Repository, branch, or path"
            autocomplete="off"
          />
        </label>
        <label>
          <span>Sort</span>
          <select v-model="sortMode">
            <option value="dirty">Changes first</option>
            <option value="name">Name</option>
            <option value="scripts">Script count</option>
          </select>
        </label>
      </div>

      <div v-if="filteredRepositories.length === 0" class="empty-state">
        No repositories match this filter.
      </div>

      <div v-else class="repo-grid">
        <RepositoryCard
          v-for="repository in filteredRepositories"
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
    </template>
  </section>
</template>
