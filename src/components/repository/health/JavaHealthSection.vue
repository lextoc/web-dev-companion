<script setup lang="ts">
import { computed } from "vue";
import type { ProjectHealthStatus, ProjectJavaHealth, ProjectTask, ScriptTerminal } from "../../../repositories";
import RunProjectHealthScriptsButton from "./RunProjectHealthScriptsButton.vue";

const props = defineProps<{
  java: ProjectJavaHealth;
  tasks: ProjectTask[];
  taskTerminalsByTask: Record<string, ScriptTerminal>;
}>();

const emit = defineEmits<{
  runTask: [taskId: string];
  restartTask: [taskId: string];
  openTask: [taskId: string];
}>();

const gradleTasks = computed(() => props.tasks.filter((task) => task.source === "gradle"));
const mavenTasks = computed(() => props.tasks.filter((task) => task.source === "maven"));
const checkTasks = computed(() =>
  props.tasks.filter((task) => ["test", "check", "build", "package", "verify"].includes(task.name)),
);
const tools = computed(() => [
  ...(gradleTasks.value.length > 0 ? ["Gradle"] : []),
  ...(mavenTasks.value.length > 0 ? ["Maven"] : []),
]);

function healthStatusLabel(status: ProjectHealthStatus) {
  if (status === "ok") {
    return "OK";
  }

  if (status === "warning") {
    return "Warning";
  }

  if (status === "error") {
    return "Error";
  }

  return "Unknown";
}

function compactPath(value?: string) {
  if (!value) {
    return "None";
  }

  const home = value.match(/^\/Users\/[^/]+/)?.[0];

  return home ? value.replace(home, "~") : value;
}

function terminalForTask(task: ProjectTask) {
  return props.taskTerminalsByTask[task.id];
}

function taskRuntimeStatus(task: ProjectTask) {
  const terminal = terminalForTask(task);

  if (!terminal) {
    return "idle";
  }

  if (terminal.isRunning) {
    return "running";
  }

  if (terminal.signal) {
    return "stopped";
  }

  if (terminal.exitCode !== null && terminal.exitCode !== undefined && terminal.exitCode !== 0) {
    return "failed";
  }

  return "finished";
}

function taskRuntimeStatusLabel(task: ProjectTask) {
  const status = taskRuntimeStatus(task);

  if (status === "running") {
    return "Running";
  }

  if (status === "stopped") {
    return "Stopped";
  }

  if (status === "failed") {
    return "Failed";
  }

  if (status === "finished") {
    return "Finished";
  }

  return "Ready";
}

function openOrRunTask(task: ProjectTask) {
  if (terminalForTask(task)) {
    emit("openTask", task.id);
    return;
  }

  emit("runTask", task.id);
}

function restartOrRunTask(task: ProjectTask) {
  if (terminalForTask(task)) {
    emit("restartTask", task.id);
    return;
  }

  emit("runTask", task.id);
}
</script>

<template>
  <section class="project-health-ecosystem" aria-label="Java health">
    <div class="project-health-section-heading">
      <div>
        <span>Java</span>
        <h4>{{ tools.join(" + ") || "No build tool" }}</h4>
      </div>
    </div>

    <div class="project-health-grid java-summary-grid">
      <article class="project-health-card" :class="java.status">
        <div class="project-health-card-heading">
          <span>Java runtime</span>
          <strong>{{ healthStatusLabel(java.status) }}</strong>
        </div>
        <dl>
          <div>
            <dt>Runtime</dt>
            <dd>{{ java.current ?? "Unknown" }}</dd>
          </div>
          <div>
            <dt>Compiler</dt>
            <dd>{{ java.compiler ?? "Unknown" }}</dd>
          </div>
          <div>
            <dt>Required</dt>
            <dd>{{ java.requiredRelease ? `Java ${java.requiredRelease}` : "Unknown" }}</dd>
          </div>
          <div>
            <dt>Configured</dt>
            <dd>{{ java.configured ?? "None" }}</dd>
          </div>
          <div>
            <dt>JAVA_HOME</dt>
            <dd :title="java.javaHome">{{ compactPath(java.javaHome) }}</dd>
          </div>
        </dl>
        <ul v-if="java.messages.length > 0" class="project-health-messages">
          <li v-for="entry in java.messages" :key="`java-${entry.text}`" :class="entry.level">
            {{ entry.text }}
          </li>
        </ul>
      </article>

      <article class="project-health-card" :class="gradleTasks.length > 0 ? 'ok' : 'unknown'">
        <div class="project-health-card-heading">
          <span>Gradle</span>
          <strong>{{ gradleTasks.length > 0 ? "Detected" : "Not found" }}</strong>
        </div>
        <dl>
          <div>
            <dt>Tasks</dt>
            <dd>{{ gradleTasks.length }}</dd>
          </div>
          <div>
            <dt>Runner</dt>
            <dd>{{ gradleTasks[0]?.command.split(" ")[0] ?? "None" }}</dd>
          </div>
          <div>
            <dt>Wrapper</dt>
            <dd>{{ java.gradleWrapperPresent ? "Found" : "Missing" }}</dd>
          </div>
        </dl>
      </article>

      <article class="project-health-card" :class="mavenTasks.length > 0 ? 'ok' : 'unknown'">
        <div class="project-health-card-heading">
          <span>Maven</span>
          <strong>{{ mavenTasks.length > 0 ? "Detected" : "Not found" }}</strong>
        </div>
        <dl>
          <div>
            <dt>Goals</dt>
            <dd>{{ mavenTasks.length }}</dd>
          </div>
          <div>
            <dt>Runner</dt>
            <dd>{{ mavenTasks[0]?.command.split(" ")[0] ?? "None" }}</dd>
          </div>
          <div>
            <dt>Wrapper</dt>
            <dd>{{ java.mavenWrapperPresent ? "Found" : "Missing" }}</dd>
          </div>
          <div>
            <dt>System</dt>
            <dd>{{ java.maven ?? (java.mavenWrapperPresent ? "Not required" : "Unknown") }}</dd>
          </div>
        </dl>
      </article>
    </div>

    <section class="project-health-section">
      <div class="project-health-section-heading">
        <div>
          <span>Build checks</span>
          <h4>{{ tasks.length }} available</h4>
        </div>
        <div class="project-health-section-actions">
          <RunProjectHealthScriptsButton
            :tasks="checkTasks"
            :task-terminals-by-task="taskTerminalsByTask"
            run-label="Run Java checks"
            @run-task="$emit('runTask', $event)"
            @restart-task="$emit('restartTask', $event)"
          />
        </div>
      </div>

      <div class="project-health-script-table">
        <div
          v-for="task in tasks"
          :key="task.id"
          class="project-health-script-row"
          :class="taskRuntimeStatus(task)"
          role="button"
          tabindex="0"
          :title="terminalForTask(task) ? 'Open terminal' : 'Run task'"
          @click="openOrRunTask(task)"
          @keydown.enter="openOrRunTask(task)"
          @keydown.space.prevent="openOrRunTask(task)"
        >
          <div>
            <strong>{{ task.name }}</strong>
            <small>{{ task.command }}</small>
          </div>
          <span>{{ taskRuntimeStatusLabel(task) }}</span>
          <button type="button" class="secondary" @click.stop="restartOrRunTask(task)">
            {{ terminalForTask(task) ? "Restart" : "Run" }}
          </button>
        </div>
      </div>
    </section>
  </section>
</template>
