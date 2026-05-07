<script setup lang="ts">
defineProps<{
  description?: string
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

function updateValue(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <label class="app-checkbox">
    <input :checked="modelValue" type="checkbox" @change="updateValue" />
    <span>
      <strong><slot /></strong>
      <small v-if="description">{{ description }}</small>
    </span>
  </label>
</template>
