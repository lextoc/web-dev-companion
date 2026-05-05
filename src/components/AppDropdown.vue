<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface AppDropdownOption {
  label: string
  value: string | number
}

const props = defineProps<{
  disabled?: boolean
  id?: string
  modelValue: string | number
  options: AppDropdownOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
}>()

const dropdownElement = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const highlightedIndex = ref(0)

const selectedOption = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
)

watch(isOpen, (open) => {
  if (!open) {
    return
  }

  highlightedIndex.value = Math.max(0, props.options.findIndex((option) => option.value === props.modelValue))
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
  emit('update:modelValue', option.value)
  closeDropdown()
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

  nextTick(() => {
    dropdownElement.value
      ?.querySelector<HTMLElement>(`[data-option-index="${highlightedIndex.value}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })
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
  if (!dropdownElement.value?.contains(event.target as Node)) {
    closeDropdown()
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
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

    <div v-if="isOpen" class="app-dropdown-menu" role="listbox" :aria-labelledby="id">
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
        {{ option.label }}
      </button>
    </div>
  </div>
</template>
