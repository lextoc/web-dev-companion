<script setup lang="ts">
import { computed } from "vue";
import type { ProjectHealth, ProjectTask, ScriptTerminal } from "../../../repositories";

const props = defineProps<{
  health?: ProjectHealth | null;
  loading?: boolean;
  scriptTerminalsByScript?: Record<string, ScriptTerminal>;
  tasks?: ProjectTask[];
  taskTerminalsByTask?: Record<string, ScriptTerminal>;
  runLabel?: string;
}>();

const emit = defineEmits<{
  runScript: [scriptName: string];
  restartScript: [scriptName: string];
  runTask: [taskId: string];
  restartTask: [taskId: string];
}>();

const availableScripts = computed(() => props.health?.scripts.filter((script) => script.present) ?? []);
const runnableScripts = computed(() =>
  availableScripts.value.filter((script) => !props.scriptTerminalsByScript?.[script.name]?.isRunning),
);
const availableTasks = computed(() => props.tasks ?? []);
const runnableTasks = computed(() =>
  availableTasks.value.filter((task) => !props.taskTerminalsByTask?.[task.id]?.isRunning),
);
const usesTasks = computed(() => props.tasks !== undefined);
const isDisabled = computed(() =>
  props.loading || (usesTasks.value ? runnableTasks.value.length === 0 : runnableScripts.value.length === 0),
);
const label = computed(() => {
  if (props.loading) {
    return usesTasks.value ? "Loading tasks" : "Loading checks";
  }

  if (usesTasks.value && availableTasks.value.length === 0) {
    return "No checks";
  }

  if (usesTasks.value && runnableTasks.value.length === 0) {
    return "Tasks running";
  }

  if (usesTasks.value) {
    return props.runLabel ?? "Run tasks";
  }

  if (!props.health || availableScripts.value.length === 0) {
    return "No checks";
  }

  if (runnableScripts.value.length === 0) {
    return "Checks running";
  }

  return props.runLabel ?? "Check health";
});
const title = computed(() => {
  if (usesTasks.value && availableTasks.value.length === 0) {
    return "No project check tasks are available.";
  }

  if (usesTasks.value && runnableTasks.value.length === 0) {
    return "All available tasks are already running.";
  }

  if (usesTasks.value) {
    return "Run available project tasks.";
  }

  if (!props.health) {
    return "Project health has not loaded yet.";
  }

  if (availableScripts.value.length === 0) {
    return "No common Node scripts are available.";
  }

  if (runnableScripts.value.length === 0) {
    return "All common Node scripts are already running.";
  }

  return "Run available common Node scripts to check project health.";
});

function runItems() {
  if (isDisabled.value) {
    return;
  }

  if (usesTasks.value) {
    for (const task of runnableTasks.value) {
      if (props.taskTerminalsByTask?.[task.id]) {
        emit("restartTask", task.id);
      } else {
        emit("runTask", task.id);
      }
    }

    return;
  }

  for (const script of runnableScripts.value) {
    if (props.scriptTerminalsByScript?.[script.name]) {
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
    @click="runItems"
  >
    {{ label }}
  </button>
</template>
