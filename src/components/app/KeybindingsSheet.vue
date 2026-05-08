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

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(4, 8, 12, 0.62);
}

.keybindings-backdrop {
  z-index: 50;
}

.keybindings-sheet {
  display: grid;
  width: min(760px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 0;
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  box-shadow: none;
}

.keybindings-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--border-soft);
  padding: 16px;
}

.keybindings-header div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.keybindings-header span {
  color: var(--brand);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.keybindings-header h2 {
  margin: 0;
  font-size: var(--font-size-title);
}

.keybindings-list {
  display: grid;
  gap: 16px;
  overflow: auto;
  padding: 14px;
}

.keybindings-group {
  display: grid;
  gap: 8px;
}

.keybindings-group h3 {
  margin: 0;
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.keybindings-group ul {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.keybindings-group li {
  display: grid;
  min-height: 54px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  border-radius: 8px;
  padding: 9px 10px;
  background: color-mix(in srgb, var(--surface-soft) 68%, transparent);
}

.keybinding-main {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.keybinding-main strong,
.keybinding-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.keybinding-main small {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 760;
}

.keybinding-keys {
  display: flex;
  flex-wrap: wrap;
  justify-content: end;
  gap: 6px;
}

.keybinding-keys kbd {
  min-width: 32px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 3px 7px;
  background: var(--surface);
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .keybindings-group li {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .keybinding-keys {
    justify-content: start;
  }
}
</style>
