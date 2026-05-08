<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { CommandPaletteItem } from '../../command-palette'
import { AppIcon } from '../ui'

const props = defineProps<{
  items: CommandPaletteItem[]
}>()

const emit = defineEmits<{
  close: []
  run: [itemId: string]
}>()

const query = ref('')
const selectedIndex = ref(0)
const hasRunItem = ref(false)
const listElement = ref<HTMLElement | null>(null)
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
const groupedItems = computed(() => {
  const groups: Array<{ section: string; entries: Array<{ item: CommandPaletteItem; index: number }> }> = []

  for (const [index, item] of filteredItems.value.entries()) {
    let group = groups.find((entry) => entry.section === item.section)

    if (!group) {
      group = { section: item.section, entries: [] }
      groups.push(group)
    }

    group.entries.push({ item, index })
  }

  return groups
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

watch(selectedIndex, () => {
  scrollSelectedItemIntoView()
})

nextTick(() => {
  searchInput.value?.focus()
})

function scrollSelectedItemIntoView() {
  nextTick(() => {
    const list = listElement.value
    const selectedItem = list?.querySelector<HTMLElement>(
      `[data-command-index="${selectedIndex.value}"]`,
    )

    if (!list || !selectedItem) {
      return
    }

    const listRect = list.getBoundingClientRect()
    const itemRect = selectedItem.getBoundingClientRect()
    const scrollPadding = 10

    if (itemRect.top < listRect.top + scrollPadding) {
      list.scrollTop -= listRect.top + scrollPadding - itemRect.top
      return
    }

    if (itemRect.bottom > listRect.bottom - scrollPadding) {
      list.scrollTop += itemRect.bottom - (listRect.bottom - scrollPadding)
    }
  })
}

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
    runItem(selectedItem)
  }
}

function runItem(item: CommandPaletteItem) {
  if (hasRunItem.value) {
    return
  }

  hasRunItem.value = true
  emit('run', item.actionId ?? item.id)
}

function runItemFromPointer(event: PointerEvent, item: CommandPaletteItem) {
  if (event.button !== 0) {
    return
  }

  event.preventDefault()
  runItem(item)
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

      <div
        v-if="filteredItems.length > 0"
        ref="listElement"
        class="command-palette-list"
        role="listbox"
      >
        <section
          v-for="group in groupedItems"
          :key="group.section"
          class="command-palette-group"
          :aria-label="group.section"
        >
          <h3>{{ group.section }}</h3>
          <ol>
            <li
              v-for="{ item, index } in group.entries"
              :id="`command-palette-item-${index}`"
              :key="item.id"
              :data-command-index="index"
              role="option"
              :aria-selected="index === selectedIndex"
            >
              <button
                type="button"
                class="command-palette-item"
                :class="{ active: index === selectedIndex }"
                @mouseenter="selectedIndex = index"
                @pointerdown="runItemFromPointer($event, item)"
                @click="runItem(item)"
              >
                <span class="command-palette-item-icon" aria-hidden="true">
                  <AppIcon :name="item.icon" />
                </span>
                <span class="command-palette-item-main">
                  <strong>{{ item.title }}</strong>
                  <span v-if="item.subtitle">{{ item.subtitle }}</span>
                </span>
                <span class="command-palette-item-side">
                  <kbd v-if="item.meta">{{ item.meta }}</kbd>
                </span>
              </button>
            </li>
          </ol>
        </section>
      </div>

      <div v-else class="command-palette-empty">
        No matching commands.
      </div>
    </section>
  </div>
</template>
