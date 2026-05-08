<script setup lang="ts">
import { computed } from "vue";
import type { ProjectHealth, ScriptTerminal } from "../../../repositories";

const props = defineProps<{
  health: ProjectHealth | null;
  loading?: boolean;
  scriptTerminalsByScript: Record<string, ScriptTerminal>;
}>();

const emit = defineEmits<{
  runScript: [scriptName: string];
  restartScript: [scriptName: string];
}>();

const availableScripts = computed(() => props.health?.scripts.filter((script) => script.present) ?? []);
const runnableScripts = computed(() =>
  availableScripts.value.filter((script) => !props.scriptTerminalsByScript[script.name]?.isRunning),
);
const isDisabled = computed(() => props.loading || runnableScripts.value.length === 0);
const label = computed(() => {
  if (!props.health && props.loading) {
    return "Loading scripts";
  }

  if (!props.health || availableScripts.value.length === 0) {
    return "No scripts";
  }

  if (runnableScripts.value.length === 0) {
    return "Scripts running";
  }

  return "Check health";
});
const title = computed(() => {
  if (!props.health) {
    return "Project health has not loaded yet.";
  }

  if (availableScripts.value.length === 0) {
    return "No common scripts are available.";
  }

  if (runnableScripts.value.length === 0) {
    return "All common scripts are already running.";
  }

  return "Run available common scripts to check project health.";
});

function runScripts() {
  if (isDisabled.value) {
    return;
  }

  for (const script of runnableScripts.value) {
    if (props.scriptTerminalsByScript[script.name]) {
      emit("restartScript", script.name);
    } else {
      emit("runScript", script.name);
    }
  }
}
</script>

<template>
  <button
    type="button"
    :disabled="isDisabled"
    :title="title"
    @click="runScripts"
  >
    {{ label }}
  </button>
</template>
