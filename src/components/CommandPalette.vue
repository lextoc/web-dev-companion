<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { CommandPaletteItem } from '../command-palette'

const props = defineProps<{
  items: CommandPaletteItem[]
}>()

const emit = defineEmits<{
  close: []
  run: [itemId: string]
}>()

const query = ref('')
const selectedIndex = ref(0)
const searchInput = ref<HTMLInputElement | null>(null)

const filteredItems = computed(() => {
  const terms = query.value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (terms.length === 0) {
    return props.items
  }

  return props.items.filter((item) => {
    const searchableText = [
      item.title,
      item.subtitle,
      item.meta,
      item.section,
      ...(item.keywords ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return terms.every((term) => searchableText.includes(term))
  })
})

watch(
  () => filteredItems.value.length,
  (length) => {
    selectedIndex.value = Math.min(selectedIndex.value, Math.max(0, length - 1))
  },
)

watch(query, () => {
  selectedIndex.value = 0
})

nextTick(() => {
  searchInput.value?.focus()
})

function selectNext() {
  if (filteredItems.value.length === 0) {
    return
  }

  selectedIndex.value = (selectedIndex.value + 1) % filteredItems.value.length
}

function selectPrevious() {
  if (filteredItems.value.length === 0) {
    return
  }

  selectedIndex.value =
    selectedIndex.value === 0 ? filteredItems.value.length - 1 : selectedIndex.value - 1
}

function runSelected() {
  const selectedItem = filteredItems.value[selectedIndex.value]

  if (selectedItem) {
    emit('run', selectedItem.id)
  }
}
</script>

<template>
  <div class="modal-backdrop command-palette-backdrop" role="presentation" @click.self="$emit('close')">
    <section
      class="command-palette"
      role="dialog"
      aria-modal="true"
      aria-labelledby="command-palette-title"
      @keydown.esc.prevent="$emit('close')"
      @keydown.down.prevent="selectNext"
      @keydown.up.prevent="selectPrevious"
      @keydown.enter.prevent="runSelected"
    >
      <div class="command-palette-input-row">
        <label id="command-palette-title" for="command-palette-input">Command palette</label>
        <input
          id="command-palette-input"
          ref="searchInput"
          v-model="query"
          type="search"
          autocomplete="off"
          spellcheck="false"
          placeholder="Search repositories, scripts, and actions"
        />
      </div>

      <ol v-if="filteredItems.length > 0" class="command-palette-list" role="listbox">
        <li
          v-for="(item, index) in filteredItems"
          :id="`command-palette-item-${item.id}`"
          :key="item.id"
          role="option"
          :aria-selected="index === selectedIndex"
        >
          <button
            type="button"
            class="command-palette-item"
            :class="{ active: index === selectedIndex }"
            @mouseenter="selectedIndex = index"
            @click="$emit('run', item.id)"
          >
            <span class="command-palette-item-main">
              <strong>{{ item.title }}</strong>
              <span v-if="item.subtitle">{{ item.subtitle }}</span>
            </span>
            <span class="command-palette-item-side">
              <span>{{ item.section }}</span>
              <kbd v-if="item.meta">{{ item.meta }}</kbd>
            </span>
          </button>
        </li>
      </ol>

      <div v-else class="command-palette-empty">
        No matching commands.
      </div>
    </section>
  </div>
</template>
