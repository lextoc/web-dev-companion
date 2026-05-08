<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { KeybindingDefinition, KeybindingPlatform } from '../../keybindings'
import { AppButton } from '../ui'

const props = defineProps<{
  keybindings: KeybindingDefinition[]
  platform: KeybindingPlatform
}>()

defineEmits<{
  close: []
}>()

const closeButton = ref<InstanceType<typeof AppButton> | null>(null)

const groupedKeybindings = computed(() => {
  const groups: Array<{ section: string; entries: KeybindingDefinition[] }> = []

  for (const keybinding of props.keybindings) {
    let group = groups.find((entry) => entry.section === keybinding.section)

    if (!group) {
      group = { section: keybinding.section, entries: [] }
      groups.push(group)
    }

    group.entries.push(keybinding)
  }

  return groups
})

nextTick(() => {
  closeButton.value?.$el.focus()
})
</script>

<template>
  <div class="modal-backdrop keybindings-backdrop" role="presentation" @click.self="$emit('close')">
    <section
      class="keybindings-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="keybindings-title"
      @keydown.esc.prevent="$emit('close')"
    >
      <header class="keybindings-header">
        <div>
          <span>Reference</span>
          <h2 id="keybindings-title">Keyboard shortcuts</h2>
        </div>
        <AppButton
          ref="closeButton"
          variant="secondary"
          size="icon"
          icon="close"
          aria-label="Close keyboard shortcuts"
          @click="$emit('close')"
        >
          Close
        </AppButton>
      </header>

      <div class="keybindings-list">
        <section
          v-for="group in groupedKeybindings"
          :key="group.section"
          class="keybindings-group"
          :aria-label="group.section"
        >
          <h3>{{ group.section }}</h3>
          <ul>
            <li v-for="keybinding in group.entries" :key="keybinding.id">
              <span class="keybinding-main">
                <strong>{{ keybinding.title }}</strong>
                <small>{{ keybinding.scope }}</small>
              </span>
              <span class="keybinding-keys" aria-label="Shortcut">
                <kbd v-for="key in keybinding.keys[platform]" :key="key">{{ key }}</kbd>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </section>
  </div>
</template>
