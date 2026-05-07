<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

export interface AppTabItem {
  key: string
  label: string
}

const props = withDefaults(defineProps<{
  label: string
  modelValue: string
  panelClass?: string
  tablistClass?: string
  tabs: AppTabItem[]
}>(), {
  panelClass: '',
  tablistClass: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const tabButtonElements = ref<Array<HTMLButtonElement | null>>([])
const activeTab = computed(() =>
  props.tabs.find((tab) => tab.key === props.modelValue) ?? props.tabs[0],
)
const activeTabIndex = computed(() =>
  Math.max(0, props.tabs.findIndex((tab) => tab.key === activeTab.value?.key)),
)

function tabId(tab: AppTabItem) {
  return `tab-${tab.key}`
}

function panelId(tab: AppTabItem) {
  return `panel-${tab.key}`
}

function selectTab(tab: AppTabItem) {
  emit('update:modelValue', tab.key)
}

function focusTab(index: number) {
  const tab = props.tabs[index]

  if (!tab) {
    return
  }

  selectTab(tab)
  void nextTick(() => {
    tabButtonElements.value[index]?.focus()
  })
}

function focusRelativeTab(offset: number) {
  if (props.tabs.length === 0) {
    return
  }

  focusTab((activeTabIndex.value + offset + props.tabs.length) % props.tabs.length)
}
</script>

<template>
  <nav :class="tablistClass" role="tablist" :aria-label="label">
    <button
      v-for="(tab, index) in tabs"
      :id="tabId(tab)"
      :key="tab.key"
      :ref="(element) => { tabButtonElements[index] = element as HTMLButtonElement | null }"
      type="button"
      class="secondary"
      :class="{ active: tab.key === activeTab?.key }"
      role="tab"
      :aria-selected="tab.key === activeTab?.key"
      :aria-controls="panelId(tab)"
      :tabindex="tab.key === activeTab?.key ? 0 : -1"
      @click="selectTab(tab)"
      @keydown.left.prevent="focusRelativeTab(-1)"
      @keydown.right.prevent="focusRelativeTab(1)"
      @keydown.home.prevent="focusTab(0)"
      @keydown.end.prevent="focusTab(tabs.length - 1)"
    >
      {{ tab.label }}
    </button>
  </nav>

  <div
    v-if="activeTab"
    :id="panelId(activeTab)"
    :class="panelClass"
    role="tabpanel"
    :aria-labelledby="tabId(activeTab)"
  >
    <slot :name="activeTab.key" />
  </div>
</template>
