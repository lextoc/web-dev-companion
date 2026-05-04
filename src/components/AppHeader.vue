<script setup lang="ts">
defineProps<{
  repositoryCount: number
}>()
</script>

<template>
  <header class="top-bar">
    <div class="brand-heading">
      <img src="/web-dev-companion.svg" alt="" aria-hidden="true" />
      <div>
        <p class="eyebrow">Web Dev Companion</p>
        <h1>Repositories</h1>
      </div>
    </div>

    <div class="repo-count">
      <span>{{ repositoryCount }}</span>
      <small>saved</small>
    </div>
  </header>
</template>
