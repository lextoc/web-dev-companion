<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'
import AppIcon from './AppIcon.vue'

const props = withDefaults(defineProps<{
  align?: 'left' | 'right'
  label: string
}>(), {
  align: 'right',
})

const menuRoot = ref<HTMLElement | null>(null)
const menuElement = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const menuStyle = ref<CSSProperties>({})

watch(isOpen, (open) => {
  if (open) {
    nextTick(updateMenuPosition)
  }
})

function closeMenu() {
  isOpen.value = false
}

function toggleMenu() {
  isOpen.value = !isOpen.value
}

function updateMenuPosition() {
  if (!isOpen.value || !menuRoot.value) {
    return
  }

  const rect = menuRoot.value.getBoundingClientRect()
  const viewportGap = 12
  const menuGap = 5
  const menuWidth = Math.min(260, window.innerWidth - viewportGap * 2)
  const preferredLeft = props.align === 'left' ? rect.left : rect.right - menuWidth
  const left = Math.max(
    viewportGap,
    Math.min(preferredLeft, window.innerWidth - menuWidth - viewportGap),
  )
  const spaceBelow = window.innerHeight - rect.bottom - viewportGap
  const spaceAbove = rect.top - viewportGap
  const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow

  menuStyle.value = {
    bottom: openAbove ? `${window.innerHeight - rect.top + menuGap}px` : undefined,
    left: `${left}px`,
    minWidth: '220px',
    top: openAbove ? undefined : `${rect.bottom + menuGap}px`,
  }
}

function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node

  if (!menuRoot.value?.contains(target) && !menuElement.value?.contains(target)) {
    closeMenu()
  }
}

function updateOpenMenuPosition() {
  if (isOpen.value) {
    updateMenuPosition()
  }
}

function handleMenuClick(event: MouseEvent) {
  const target = event.target as Element | null
  const button = target?.closest('button')

  if (button && !button.disabled) {
    nextTick(closeMenu)
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  window.addEventListener('resize', updateOpenMenuPosition)
  window.addEventListener('scroll', updateOpenMenuPosition, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  window.removeEventListener('resize', updateOpenMenuPosition)
  window.removeEventListener('scroll', updateOpenMenuPosition, true)
})
</script>

<template>
  <div ref="menuRoot" class="action-menu" :class="{ open: isOpen }">
    <button
      type="button"
      class="secondary subtle-icon-button action-menu-trigger"
      :aria-label="label"
      :aria-expanded="isOpen"
      aria-haspopup="menu"
      :title="label"
      @click="toggleMenu"
      @keydown.esc.prevent="closeMenu"
    >
      <AppIcon name="more-horizontal" class="button-icon" />
    </button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        ref="menuElement"
        class="action-menu-popover"
        :class="align === 'left' ? 'align-left' : 'align-right'"
        role="menu"
        :style="menuStyle"
        @click="handleMenuClick"
        @keydown.esc.prevent="closeMenu"
      >
        <slot />
      </div>
    </Teleport>
  </div>
</template>
