<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'

type AppMenuItemTone = 'default' | 'danger'
type AppMenuItemIcon =
  | 'copy'
  | 'edit'
  | 'folder'
  | 'link'
  | 'merge'
  | 'restart'
  | 'terminal'
  | 'trash'

const props = withDefaults(defineProps<{
  icon?: AppMenuItemIcon
  tone?: AppMenuItemTone
  type?: 'button' | 'submit' | 'reset'
}>(), {
  tone: 'default',
  type: 'button',
})

const menuItemClasses = computed(() => ({
  'action-menu-item': true,
  danger: props.tone === 'danger',
}))
</script>

<template>
  <button :type="type" :class="menuItemClasses" role="menuitem">
    <AppIcon v-if="icon" :name="icon" class="button-icon" />
    <span><slot /></span>
  </button>
</template>
