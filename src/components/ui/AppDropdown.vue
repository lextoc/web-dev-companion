<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'

export interface AppDropdownOption {
  label: string
  value: string | number
}

const props = defineProps<{
  disabled?: boolean
  id?: string
  menuClass?: string
  modelValue: string | number
  options: AppDropdownOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
}>()

const dropdownElement = ref<HTMLElement | null>(null)
const menuElement = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const highlightedIndex = ref(0)
const menuStyle = ref<CSSProperties>({})

const selectedOption = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
)

watch(isOpen, (open) => {
  if (!open) {
    return
  }

  highlightedIndex.value = Math.max(0, props.options.findIndex((option) => option.value === props.modelValue))
  nextTick(() => {
    updateMenuPosition()
    scrollHighlightedOption()
  })
})

function closeDropdown() {
  isOpen.value = false
}

function toggleDropdown() {
  if (props.disabled) {
    return
  }

  isOpen.value = !isOpen.value
}

function selectOption(option: AppDropdownOption) {
  closeDropdown()
  emit('update:modelValue', option.value)
}

function selectHighlightedOption() {
  const option = props.options[highlightedIndex.value]

  if (option) {
    selectOption(option)
  }
}

function moveHighlight(offset: number) {
  if (props.options.length === 0) {
    return
  }

  highlightedIndex.value =
    (highlightedIndex.value + offset + props.options.length) % props.options.length

  nextTick(scrollHighlightedOption)
}

function scrollHighlightedOption() {
  menuElement.value
    ?.querySelector<HTMLElement>(`[data-option-index="${highlightedIndex.value}"]`)
    ?.scrollIntoView({ block: 'nearest' })
}

function updateMenuPosition() {
  if (!isOpen.value || !dropdownElement.value) {
    return
  }

  const rect = dropdownElement.value.getBoundingClientRect()
  const viewportGap = 16
  const menuGap = 5
  const spaceBelow = window.innerHeight - rect.bottom - viewportGap
  const spaceAbove = rect.top - viewportGap
  const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow
  const availableHeight = Math.max(140, Math.min(280, (openAbove ? spaceAbove : spaceBelow) - menuGap))
  const maxWidth = Math.max(rect.width, Math.min(720, window.innerWidth - rect.left - viewportGap))

  menuStyle.value = {
    bottom: openAbove ? `${window.innerHeight - rect.top + menuGap}px` : undefined,
    left: `${Math.max(viewportGap, rect.left)}px`,
    maxHeight: `${availableHeight}px`,
    maxWidth: `${maxWidth}px`,
    minWidth: `${rect.width}px`,
    top: openAbove ? undefined : `${rect.bottom + menuGap}px`,
  }
}

function handleButtonKeydown(event: KeyboardEvent) {
  if (props.disabled) {
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    isOpen.value = true
    moveHighlight(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    isOpen.value = true
    moveHighlight(-1)
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    if (isOpen.value) {
      selectHighlightedOption()
      return
    }

    isOpen.value = true
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeDropdown()
  }
}

function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node

  if (!dropdownElement.value?.contains(target) && !menuElement.value?.contains(target)) {
    closeDropdown()
  }
}

function updateOpenMenuPosition() {
  if (isOpen.value) {
    updateMenuPosition()
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
  <div ref="dropdownElement" class="app-dropdown" :class="{ open: isOpen, disabled }">
    <button
      :id="id"
      type="button"
      class="secondary app-dropdown-button"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      @click="toggleDropdown"
      @keydown="handleButtonKeydown"
    >
      <span>{{ selectedOption?.label ?? 'Select' }}</span>
      <span class="app-dropdown-chevron" aria-hidden="true">⌄</span>
    </button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        ref="menuElement"
        class="app-dropdown-menu"
        :class="menuClass"
        role="listbox"
        :aria-labelledby="id"
        :style="menuStyle"
      >
        <button
          v-for="(option, index) in options"
          :key="`${option.value}`"
          type="button"
          class="app-dropdown-option"
          :class="{
            active: option.value === modelValue,
            highlighted: index === highlightedIndex,
          }"
          role="option"
          :aria-selected="option.value === modelValue"
          :data-option-index="index"
          @mouseenter="highlightedIndex = index"
          @click="selectOption(option)"
        >
          <span class="app-dropdown-option-label">{{ option.label }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
