<script setup lang="ts">
defineProps<{
  repositoryCount: number
}>()
</script>

<template>
  <header class="top-bar">
    <div>
      <p class="eyebrow">Web Dev Companion</p>
      <h1>Repositories</h1>
    </div>

    <div class="repo-count">
      <span>{{ repositoryCount }}</span>
      <small>saved</small>
    </div>
  </header>
</template>
