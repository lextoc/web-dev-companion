<script setup lang="ts">
defineProps<{
  name:
    | "arrow-left"
    | "check"
    | "command"
    | "copy"
    | "close"
    | "edit"
    | "folder"
    | "home"
    | "hide"
    | "link"
    | "merge"
    | "more-horizontal"
    | "panel-hide"
    | "pin"
    | "pin-off"
    | "play"
    | "pull"
    | "push"
    | "repository"
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
    <g v-if="name === 'arrow-left'">
      <path d="M19 12H5" />
      <path d="M12 5l-7 7 7 7" />
    </g>
    <g v-else-if="name === 'check'">
      <path d="M20 6L9 17l-5-5" />
    </g>
    <g v-else-if="name === 'command'">
      <path d="M9 9H7.5A2.5 2.5 0 1 1 10 6.5V18a2.5 2.5 0 1 1-2.5-2.5H18a2.5 2.5 0 1 1-2.5 2.5V6.5A2.5 2.5 0 1 1 18 9z" />
    </g>
    <g v-else-if="name === 'pin'">
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
    <g v-else-if="name === 'push'">
      <path d="M12 19V5" />
      <path d="M7 10l5-5 5 5" />
      <path d="M5 19h14" />
    </g>
    <g v-else-if="name === 'pull'">
      <path d="M12 5v14" />
      <path d="M7 14l5 5 5-5" />
      <path d="M5 5h14" />
    </g>
    <g v-else-if="name === 'repository'">
      <path d="M5 5h14v14H5z" />
      <path d="M8 9h8" />
      <path d="M8 12h8" />
      <path d="M8 15h5" />
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
    <g v-else-if="name === 'link'">
      <path d="M10 13a5 5 0 0 0 7.1 0l1.4-1.4a5 5 0 0 0-7.1-7.1L10.6 5.3" />
      <path d="M14 11a5 5 0 0 0-7.1 0l-1.4 1.4a5 5 0 0 0 7.1 7.1l.8-.8" />
    </g>
    <g v-else-if="name === 'merge'">
      <path d="M7 4v6a4 4 0 0 0 4 4h6" />
      <path d="M7 20V4" />
      <path d="M14 11l3 3-3 3" />
      <circle cx="7" cy="4" r="2" />
      <circle cx="7" cy="20" r="2" />
    </g>
    <g v-else-if="name === 'more-horizontal'">
      <circle cx="5" cy="12" r="1.25" class="app-icon-fill" />
      <circle cx="12" cy="12" r="1.25" class="app-icon-fill" />
      <circle cx="19" cy="12" r="1.25" class="app-icon-fill" />
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
    <g v-else-if="name === 'home'">
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6.5 10.5V20h11v-9.5" />
      <path d="M10 20v-5h4v5" />
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
