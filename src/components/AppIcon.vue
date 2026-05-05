<script setup lang="ts">
defineProps<{
  name:
    | 'copy'
    | 'edit'
    | 'folder'
    | 'hide'
    | 'pin'
    | 'pin-off'
    | 'play'
    | 'restart'
    | 'square'
    | 'terminal'
    | 'trash'
}>()
</script>

<template>
  <svg
    class="app-icon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <g v-if="name === 'pin'">
      <path d="M8 4h8" />
      <path d="M9 4l1 7-3 4h10l-3-4 1-7" />
      <path d="M12 15v5" />
    </g>
    <g v-else-if="name === 'pin-off'">
      <path d="M4 4l16 16" />
      <path d="M8 4h8" />
      <path d="M10 6l.5 4.2L8 14h6" />
      <path d="M12 15v5" />
    </g>
    <g v-else-if="name === 'play'">
      <path d="M8 5v14l11-7z" />
    </g>
    <g v-else-if="name === 'restart'">
      <path d="M20 12a8 8 0 1 1-2.35-5.65" />
      <path d="M20 4v6h-6" />
    </g>
    <g v-else-if="name === 'square'">
      <path d="M7 7h10v10H7z" />
    </g>
    <g v-else-if="name === 'hide'">
      <path d="M18 6L6 18" />
      <path d="M9 9a3 3 0 0 0 4 4" />
      <path d="M10.6 5.2A9.8 9.8 0 0 1 12 5c5 0 8 5 8 7a8.2 8.2 0 0 1-2.1 3.1" />
      <path d="M6.2 6.8C4.8 8 4 10.1 4 12c0 2 3 7 8 7 1.1 0 2.1-.2 3-.6" />
    </g>
    <g v-else-if="name === 'folder'">
      <path d="M3 7h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </g>
    <g v-else-if="name === 'edit'">
      <path d="M4 20h4l11-11-4-4L4 16z" />
      <path d="M13 7l4 4" />
    </g>
    <g v-else-if="name === 'terminal'">
      <path d="M4 17l5-5-5-5" />
      <path d="M12 19h8" />
    </g>
    <g v-else-if="name === 'copy'">
      <path d="M8 8h11v11H8z" />
      <path d="M5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" />
    </g>
    <g v-else-if="name === 'trash'">
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </g>
  </svg>
</template>
