<script setup lang="ts">
import type { RepositorySummary } from '../repositories'
import RepositoryCard from './RepositoryCard.vue'

defineProps<{
  repositories: RepositorySummary[]
  repoPathInput: string
  isLoading: boolean
}>()

defineEmits<{
  'update:repoPathInput': [value: string]
  add: []
  browse: []
  open: [repository: RepositorySummary]
  remove: [repoPath: string]
}>()
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

    <div v-if="isLoading && repositories.length === 0" class="empty-state">
      Loading repositories...
    </div>

    <div v-else-if="repositories.length === 0" class="empty-state">
      No repositories saved.
    </div>

    <div v-else class="repo-grid">
      <RepositoryCard
        v-for="repository in repositories"
        :key="repository.path"
        :repository="repository"
        @open="$emit('open', $event)"
        @remove="$emit('remove', $event)"
      />
    </div>
  </section>
</template>
