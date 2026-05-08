<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'
import AppButton from './AppButton.vue'

type AppActionMenuTriggerIcon =
  | 'arrow-left'
  | 'command'
  | 'copy'
  | 'close'
  | 'edit'
  | 'folder'
  | 'hide'
  | 'link'
  | 'merge'
  | 'more-horizontal'
  | 'panel-hide'
  | 'pin'
  | 'pin-off'
  | 'play'
  | 'pull'
  | 'push'
  | 'repository'
  | 'restart'
  | 'stop'
  | 'terminal'
  | 'trash'

const props = withDefaults(defineProps<{
  align?: 'left' | 'right'
  label: string
  triggerClass?: string
  triggerIcon?: AppActionMenuTriggerIcon
  triggerText?: string
  triggerVariant?: 'primary' | 'secondary' | 'danger'
}>(), {
  align: 'right',
  triggerIcon: 'more-horizontal',
  triggerText: '',
  triggerVariant: 'secondary',
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
    <AppButton
      :variant="triggerVariant"
      :size="triggerText ? 'default' : 'icon'"
      :icon="triggerIcon"
      :class="['action-menu-trigger', triggerClass]"
      :aria-label="label"
      :aria-expanded="isOpen"
      aria-haspopup="menu"
      :title="label"
      @click="toggleMenu"
      @keydown.esc.prevent="closeMenu"
    >
      {{ triggerText || label }}
    </AppButton>

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
