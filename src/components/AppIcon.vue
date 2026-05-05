<script setup lang="ts">
defineProps<{
  name:
    | "copy"
    | "close"
    | "edit"
    | "folder"
    | "hide"
    | "panel-hide"
    | "pin"
    | "pin-off"
    | "play"
    | "restart"
    | "stop"
    | "terminal"
    | "trash";
}>();
</script>

<template>
  <svg
    class="app-icon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <g v-if="name === 'pin'">
      <path d="M12 16v5" />
      <path d="M8 5h8" />
      <path d="M10 5v5l-3 5h10l-3-5V5" />
    </g>
    <g v-else-if="name === 'pin-off'">
      <path d="M12 16v5" />
      <path d="M8 5h8" />
      <path d="M10 5v5l-3 5h10l-3-5V5" />
      <path d="M5 5l14 14" />
    </g>
    <g v-else-if="name === 'play'">
      <path d="M8 5v14l11-7z" />
    </g>
    <g v-else-if="name === 'restart'">
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </g>
    <g v-else-if="name === 'stop'">
      <rect x="7" y="7" width="10" height="10" rx="1.5" class="app-icon-fill" />
    </g>
    <g v-else-if="name === 'hide'">
      <path d="M18 6L6 18" />
      <path d="M9 9a3 3 0 0 0 4 4" />
      <path
        d="M10.6 5.2A9.8 9.8 0 0 1 12 5c5 0 8 5 8 7a8.2 8.2 0 0 1-2.1 3.1"
      />
      <path d="M6.2 6.8C4.8 8 4 10.1 4 12c0 2 3 7 8 7 1.1 0 2.1-.2 3-.6" />
    </g>
    <g v-else-if="name === 'panel-hide'">
      <path d="M4 5h16v14H4z" />
      <path d="M15 5v14" />
      <path d="M11 9l-3 3 3 3" />
    </g>
    <g v-else-if="name === 'close'">
      <path d="M7 7l10 10" />
      <path d="M17 7L7 17" />
    </g>
    <g v-else-if="name === 'folder'">
      <path
        d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"
      />
    </g>
    <g v-else-if="name === 'edit'">
      <path d="M4 20h4l11-11-4-4L4 16z" />
      <path d="M13 7l4 4" />
    </g>
    <g v-else-if="name === 'terminal'">
      <path d="M4 5h16v14H4z" />
      <path d="M7 9l3 3-3 3" />
      <path d="M12 15h5" />
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
