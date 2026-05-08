<script setup lang="ts">
import { computed } from "vue";
import type {
  ProjectHealth,
  ProjectHealthStatus,
  ProjectTask,
  ScriptTerminal,
} from "../../../repositories";
import JavaHealthSection from "./JavaHealthSection.vue";
import NodeHealthSection from "./NodeHealthSection.vue";
import RubyHealthSection from "./RubyHealthSection.vue";

const props = defineProps<{
  health: ProjectHealth | null;
  projectTasks: ProjectTask[];
  loading: boolean;
  error: string | null;
  outdatedLoading: boolean;
  taskTerminalsByTask: Record<string, ScriptTerminal>;
}>();

defineEmits<{
  refresh: [];
  checkOutdated: [];
  runTask: [taskId: string];
  restartTask: [taskId: string];
  openTask: [taskId: string];
}>();

const nodeTasks = computed(() => props.projectTasks.filter((task) => task.source === "node"));
const javaTasks = computed(() => props.projectTasks.filter((task) => ["gradle", "maven"].includes(task.source)));
const rubyTasks = computed(() => props.projectTasks.filter((task) => ["rails", "rake"].includes(task.source)));

const hasNodeHealth = computed(() =>
  nodeTasks.value.length > 0 ||
  Boolean(props.health?.packageJsonPresent) ||
  Boolean(props.health?.packageManager.detected) ||
  Boolean(props.health?.node.configured) ||
  Boolean(props.health?.node.engineRange),
);
const supportedEcosystemCount = computed(() =>
  Number(hasNodeHealth.value) + Number(javaTasks.value.length > 0) + Number(rubyTasks.value.length > 0),
);

function projectHealthIssueCount(health: ProjectHealth) {
  return projectHealthAttentionItems(health).length;
}

function projectHealthAttentionItems(health: ProjectHealth) {
  const groupedMessages = hasNodeHealth.value
    ? [
        { key: "package", title: "Package manager", messages: health.packageManager.messages },
        { key: "node", title: "Node", messages: health.node.messages },
        { key: "install", title: "Install state", messages: health.install.messages },
        { key: "lockfile", title: "Lockfile", messages: health.lockfile.messages },
      ]
    : [];
  const items = groupedMessages.flatMap((group) =>
    group.messages.map((entry) => ({
      key: `${group.key}-${entry.text}`,
      level: entry.level,
      title: group.title,
      text: entry.text,
    })),
  );

  if (hasNodeHealth.value && health.dependencies.status === "outdated") {
    items.push({
      key: "dependencies-outdated",
      level: "warning",
      title: "Dependencies",
      text: `${health.dependencies.outdatedCount ?? 0} outdated dependencies found.`,
    });
  }

  if (hasNodeHealth.value && health.dependencies.status === "failed") {
    items.push({
      key: "dependencies-failed",
      level: "error",
      title: "Dependencies",
      text: health.dependencies.error ?? "Outdated dependency check failed.",
    });
  }

  for (const script of hasNodeHealth.value ? health.scripts.filter((entry) => ["failed", "timed-out"].includes(entry.status)) : []) {
    items.push({
      key: `script-${script.name}`,
      level: "error",
      title: script.name,
      text: script.error ?? "Common script failed.",
    });
  }

  return items;
}

function projectHealthOverallStatus(health: ProjectHealth): ProjectHealthStatus {
  if (
    hasNodeHealth.value &&
    (
      health.packageManager.status === "error" ||
      health.node.status === "error" ||
      health.install.status === "error" ||
      health.lockfile.status === "error" ||
      health.dependencies.status === "failed" ||
      health.scripts.some((script) => ["failed", "timed-out"].includes(script.status))
    )
  ) {
    return "error";
  }

  if (
    hasNodeHealth.value &&
    (
      health.packageManager.status === "warning" ||
      health.node.status === "warning" ||
      health.install.status === "warning" ||
      health.lockfile.status === "warning" ||
      health.dependencies.status === "outdated"
    )
  ) {
    return "warning";
  }

  if (
    supportedEcosystemCount.value === 0 ||
    (
      hasNodeHealth.value &&
      (
        health.packageManager.status === "unknown" ||
        health.node.status === "unknown" ||
        health.install.status === "unknown" ||
        health.lockfile.status === "unknown"
      )
    )
  ) {
    return "unknown";
  }

  return "ok";
}

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

function healthCheckedAtLabel(checkedAt?: string) {
  if (!checkedAt) {
    return "Not checked";
  }

  const date = new Date(checkedAt);

  if (Number.isNaN(date.getTime())) {
    return "Not checked";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<template>
  <section class="detail-panel project-health-panel" aria-live="polite">
    <header class="project-health-header">
      <div>
        <span>Project health</span>
        <h3>
          {{
            health
              ? `${healthStatusLabel(projectHealthOverallStatus(health))} · ${projectHealthIssueCount(health)} issues`
              : "Checking project"
          }}
        </h3>
        <small v-if="health">
          Updated {{ healthCheckedAtLabel(health.checkedAt) }}
        </small>
      </div>

      <div class="project-health-actions">
        <button type="button" class="secondary" :disabled="loading" @click="$emit('refresh')">
          {{ loading ? "Refreshing..." : "Refresh" }}
        </button>
      </div>
    </header>

    <p v-if="error" class="project-health-error">{{ error }}</p>

    <div v-if="loading && !health" class="project-health-loading">
      Reading project health...
    </div>

    <template v-else-if="health">
      <section
        v-if="projectHealthAttentionItems(health).length > 0"
        class="project-health-attention"
        aria-label="Health items needing attention"
      >
        <span>Needs attention</span>
        <ul>
          <li
            v-for="item in projectHealthAttentionItems(health)"
            :key="item.key"
            :class="item.level"
          >
            <strong>{{ item.title }}</strong>
            <p>{{ item.text }}</p>
          </li>
        </ul>
      </section>

      <NodeHealthSection
        v-if="hasNodeHealth"
        :health="health"
        :loading="loading"
        :outdated-loading="outdatedLoading"
        :node-tasks="nodeTasks"
        :task-terminals-by-task="taskTerminalsByTask"
        @check-outdated="$emit('checkOutdated')"
        @run-task="$emit('runTask', $event)"
        @restart-task="$emit('restartTask', $event)"
        @open-task="$emit('openTask', $event)"
      />

      <JavaHealthSection
        v-if="javaTasks.length > 0"
        :tasks="javaTasks"
        :task-terminals-by-task="taskTerminalsByTask"
        @run-task="$emit('runTask', $event)"
        @restart-task="$emit('restartTask', $event)"
        @open-task="$emit('openTask', $event)"
      />

      <RubyHealthSection
        v-if="rubyTasks.length > 0"
        :tasks="rubyTasks"
        :task-terminals-by-task="taskTerminalsByTask"
        @run-task="$emit('runTask', $event)"
        @restart-task="$emit('restartTask', $event)"
        @open-task="$emit('openTask', $event)"
      />

      <p v-if="supportedEcosystemCount === 0" class="project-health-empty">
        No supported project ecosystem detected.
      </p>
    </template>
  </section>
</template>

<style>
.scripts-panel {
  grid-column: 1 / -1;
}

.git-log-panel {
  grid-column: 1 / -1;
  padding: 0;
  overflow: hidden;
}

.project-health-panel {
  grid-column: 1 / -1;
  gap: 12px;
  background: transparent;
  padding: 0;
}

.project-health-header,
.project-health-section-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.project-health-header > div:first-child,
.project-health-section-heading > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.project-health-header span,
.project-health-section-heading span,
.project-health-card-heading span {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.project-health-header h3,
.project-health-section-heading h4 {
  margin: 0;
  color: var(--text);
  font-size: var(--font-size-title);
  line-height: 1.25;
}

.project-health-header small,
.project-health-section-heading small {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
}

.project-health-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.project-health-actions button {
  min-height: 34px;
  padding: 0 10px;
  font-size: var(--font-size-compact);
}

.project-health-attention {
  display: grid;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--warning-text) 30%, var(--border-control));
  border-radius: 8px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--warning-soft) 48%, var(--surface));
}

.project-health-attention > span {
  color: var(--warning-text);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-transform: uppercase;
}

.project-health-attention ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.project-health-attention li {
  display: grid;
  min-width: 0;
  grid-template-columns: 132px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
}

.project-health-attention strong {
  overflow: hidden;
  color: var(--text);
  font-size: var(--font-size-base);
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-health-attention p {
  margin: 0;
  color: var(--warning-text);
  font-size: var(--font-size-base);
  font-weight: 800;
  line-height: 1.35;
}

.project-health-attention li.error p {
  color: var(--danger-text);
}

.project-health-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.project-health-ecosystem {
  display: grid;
  gap: 10px;
}

.ecosystem-summary-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.project-health-card,
.project-health-section {
  display: grid;
  min-width: 0;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--border-soft) 78%, transparent);
  border-radius: 8px;
  padding: 10px;
  background: var(--surface);
}

.project-health-card {
  align-content: start;
  min-height: 168px;
}

.project-health-card.warning,
.project-health-script-row.failed,
.project-health-script-row.stopped,
.project-health-script-row.timed-out {
  border-color: color-mix(in srgb, var(--warning-text) 34%, var(--border-control));
  background: color-mix(in srgb, var(--warning-soft) 44%, var(--surface));
}

.project-health-script-row.running {
  border-color: color-mix(in srgb, var(--brand) 36%, var(--border-control));
  background: color-mix(in srgb, var(--brand-ring) 22%, var(--surface));
}

.project-health-card.error {
  border-color: color-mix(in srgb, var(--danger) 42%, var(--border-control));
  background: color-mix(in srgb, var(--danger-soft) 44%, var(--surface));
}

.project-health-card.unknown {
  background: color-mix(in srgb, var(--surface-subtle) 48%, var(--surface));
}

.project-health-card-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.project-health-card-heading strong,
.project-health-script-row > span {
  display: inline-grid;
  justify-self: end;
  width: fit-content;
  min-height: 24px;
  align-items: center;
  border-radius: 999px;
  padding: 0 8px;
  background: var(--surface-subtle);
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
  white-space: nowrap;
}

.project-health-script-row.idle > span {
  background: var(--surface-subtle);
  color: var(--muted-strong);
}

.project-health-card.ok .project-health-card-heading strong,
.project-health-script-row.passed > span,
.project-health-script-row.finished > span {
  background: var(--success-soft);
  color: var(--success-text);
}

.project-health-script-row.running > span {
  background: var(--info-soft);
  color: var(--info-text);
}

.project-health-card.warning .project-health-card-heading strong,
.project-health-script-row.failed > span,
.project-health-script-row.stopped > span,
.project-health-script-row.timed-out > span {
  background: var(--warning-soft);
  color: var(--warning-text);
}

.project-health-card.error .project-health-card-heading strong {
  background: var(--danger-soft);
  color: var(--danger-text);
}

.project-health-card dl {
  display: grid;
  gap: 6px;
  margin: 0;
}

.project-health-card dl div {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(92px, auto) minmax(0, 1fr);
  gap: 10px;
}

.project-health-card dt {
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-health-card dd {
  min-width: 0;
  overflow: hidden;
  margin: 0;
  color: var(--text);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-health-messages {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.project-health-messages li,
.project-health-error,
.project-health-loading,
.project-health-empty,
.project-health-missing-summary {
  border-radius: 7px;
  padding: 7px 9px;
  background: var(--surface-subtle);
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 800;
  line-height: 1.4;
}

.project-health-messages li.warning {
  background: var(--warning-soft);
  color: var(--warning-text);
}

.project-health-messages li.error,
.project-health-error {
  background: var(--danger-soft);
  color: var(--danger-text);
}

.project-health-error.compact {
  margin: 0;
}

.project-health-section-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.project-health-section-actions button {
  min-height: 32px;
  padding: 0 10px;
  font-size: var(--font-size-compact);
}

.project-health-check-row {
  display: grid;
  min-width: 0;
  grid-template-columns: 72px auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  border: 1px solid color-mix(in srgb, var(--border-soft) 72%, transparent);
  border-radius: 7px;
  padding: 9px 10px;
  background: color-mix(in srgb, var(--surface-soft) 58%, var(--surface));
}

.project-health-check-row span,
.project-health-check-row small {
  overflow: hidden;
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-health-check-row strong {
  color: var(--text);
  font-size: var(--font-size-base);
  font-weight: 900;
}

.project-health-dependency-table {
  display: grid;
  gap: 6px;
}

.project-health-dependency-row {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) minmax(160px, auto);
  align-items: center;
  gap: 12px;
  border: 1px solid color-mix(in srgb, var(--border-soft) 72%, transparent);
  border-radius: 7px;
  padding: 8px 10px;
  background: var(--surface);
}

.project-health-dependency-row > div {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.project-health-dependency-row strong,
.project-health-dependency-row small,
.project-health-dependency-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-health-dependency-row strong {
  color: var(--text);
  font-size: var(--font-size-base);
  font-weight: 900;
}

.project-health-dependency-row small {
  border-radius: 999px;
  padding: 2px 7px;
  background: var(--surface-subtle);
  color: var(--muted-strong);
  font-size: var(--font-size-compact);
  font-weight: 900;
}

.project-health-dependency-row span {
  justify-self: end;
  color: var(--warning-text);
  font-family: var(--font-mono);
  font-size: var(--font-size-compact);
  font-weight: 800;
}

.project-health-script-table {
  display: grid;
  gap: 6px;
}

.project-health-script-row {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) 96px 72px;
  align-items: center;
  gap: 10px;
  border: 1px solid color-mix(in srgb, var(--border-soft) 78%, transparent);
  border-radius: 7px;
  padding: 9px 10px;
  background: var(--surface);
  cursor: pointer;
}

.project-health-script-row:hover {
  background: var(--surface-hover);
}

.project-health-script-row:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--brand) 58%, transparent);
  outline-offset: 2px;
}

.project-health-script-row > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.project-health-script-row strong,
.project-health-script-row small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-health-script-row strong {
  color: var(--text);
  font-size: var(--font-size-base);
  font-weight: 900;
}

.project-health-script-row small,
.project-health-script-row time {
  color: var(--muted);
  font-size: var(--font-size-compact);
  font-weight: 800;
}

.project-health-script-row time {
  text-align: right;
}

.project-health-script-row > button {
  min-height: 30px;
  padding: 0 10px;
  font-size: var(--font-size-compact);
}

.project-health-script-row p {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--danger-text);
  font-size: var(--font-size-compact);
  font-weight: 800;
  overflow-wrap: anywhere;
}

.project-health-empty,
.project-health-missing-summary {
  margin: 0;
}

.project-health-missing-summary {
  background: transparent;
  padding: 0;
  color: var(--muted);
}

@media (max-width: 1280px) {
  .project-health-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
	  .project-health-grid,
	  .ecosystem-summary-grid,
  .project-health-attention li,
  .project-health-check-row,
  .project-health-dependency-row,
  .project-health-script-row {
    grid-template-columns: 1fr;
  }

  .project-health-header,
  .project-health-section-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .project-health-actions,
  .project-health-section-actions {
    justify-content: stretch;
  }

  .project-health-actions button,
  .project-health-section-actions button {
    flex: 1 1 auto;
  }

  .project-health-script-row time {
    text-align: left;
  }

  .project-health-script-row > span,
  .project-health-dependency-row span {
    justify-self: start;
  }
}
</style>
