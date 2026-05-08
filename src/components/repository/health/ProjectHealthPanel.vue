<script setup lang="ts">
import type {
  ProjectDependencyHealth,
  ProjectHealth,
  ProjectHealthStatus,
  ProjectScriptCheck,
  ScriptTerminal,
} from "../../../repositories";
import RunProjectHealthScriptsButton from "./RunProjectHealthScriptsButton.vue";

const props = defineProps<{
  health: ProjectHealth | null;
  loading: boolean;
  error: string | null;
  outdatedLoading: boolean;
  scriptTerminalsByScript: Record<string, ScriptTerminal>;
}>();

const emit = defineEmits<{
  refresh: [];
  checkOutdated: [];
  runScript: [scriptName: string];
  restartScript: [scriptName: string];
  openTerminal: [scriptName: string];
}>();

function projectHealthIssueCount(health: ProjectHealth) {
  return projectHealthAttentionItems(health).length;
}

function projectHealthAttentionItems(health: ProjectHealth) {
  const groupedMessages = [
    { key: "package", title: "Package manager", messages: health.packageManager.messages },
    { key: "node", title: "Node", messages: health.node.messages },
    { key: "install", title: "Install state", messages: health.install.messages },
    { key: "lockfile", title: "Lockfile", messages: health.lockfile.messages },
  ];
  const items = groupedMessages.flatMap((group) =>
    group.messages.map((entry) => ({
      key: `${group.key}-${entry.text}`,
      level: entry.level,
      title: group.title,
      text: entry.text,
    })),
  );

  if (health.dependencies.status === "outdated") {
    items.push({
      key: "dependencies-outdated",
      level: "warning",
      title: "Dependencies",
      text: `${health.dependencies.outdatedCount ?? 0} outdated dependencies found.`,
    });
  }

  if (health.dependencies.status === "failed") {
    items.push({
      key: "dependencies-failed",
      level: "error",
      title: "Dependencies",
      text: health.dependencies.error ?? "Outdated dependency check failed.",
    });
  }

  for (const script of health.scripts.filter((entry) => ["failed", "timed-out"].includes(entry.status))) {
    items.push({
      key: `script-${script.name}`,
      level: "error",
      title: script.name,
      text: script.error ?? `Script ${scriptStatusLabel(script).toLowerCase()}.`,
    });
  }

  return items;
}

function projectHealthOverallStatus(health: ProjectHealth): ProjectHealthStatus {
  if (
    health.packageManager.status === "error" ||
    health.node.status === "error" ||
    health.install.status === "error" ||
    health.lockfile.status === "error" ||
    health.dependencies.status === "failed" ||
    health.scripts.some((script) => ["failed", "timed-out"].includes(script.status))
  ) {
    return "error";
  }

  if (
    health.packageManager.status === "warning" ||
    health.node.status === "warning" ||
    health.install.status === "warning" ||
    health.lockfile.status === "warning" ||
    health.dependencies.status === "outdated"
  ) {
    return "warning";
  }

  if (
    health.packageManager.status === "unknown" ||
    health.node.status === "unknown" ||
    health.install.status === "unknown" ||
    health.lockfile.status === "unknown"
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

function dependencyStatusLabel(dependencies: ProjectDependencyHealth) {
  if (dependencies.status === "ok") {
    return "Up to date";
  }

  if (dependencies.status === "outdated") {
    return `${dependencies.outdatedCount ?? 0} outdated`;
  }

  if (dependencies.status === "failed") {
    return "Failed";
  }

  if (dependencies.status === "skipped") {
    return "Skipped";
  }

  return "Not checked";
}

function dependencyDetailLabel(dependencies: ProjectDependencyHealth) {
  if (dependencies.status === "outdated") {
    return `${dependencies.outdatedCount ?? 0} dependencies`;
  }

  if (dependencies.status === "ok") {
    return "No outdated dependencies found";
  }

  if (dependencies.status === "failed") {
    return "Check failed";
  }

  if (dependencies.status === "skipped") {
    return dependencies.error ?? "Check skipped";
  }

  return "Manual check not run";
}

function outdatedDependencyVersionLabel(current?: string, wanted?: string, latest?: string) {
  if (current && wanted && latest) {
    return `${current} -> ${wanted} / ${latest}`;
  }

  if (current && latest) {
    return `${current} -> ${latest}`;
  }

  if (wanted && latest) {
    return `${wanted} / ${latest}`;
  }

  return current ?? wanted ?? latest ?? "Version unknown";
}

function scriptStatusLabel(script: ProjectScriptCheck) {
  if (script.status === "passed") {
    return "Passed";
  }

  if (script.status === "failed") {
    return "Failed";
  }

  if (script.status === "timed-out") {
    return "Timed out";
  }

  if (script.status === "skipped") {
    return "Missing";
  }

  return "Not run";
}

function projectScriptTerminal(scriptName: string) {
  return props.scriptTerminalsByScript[scriptName];
}

function projectScriptRuntimeStatus(script: ProjectScriptCheck) {
  const terminal = projectScriptTerminal(script.name);

  if (!terminal) {
    return script.status;
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

function projectScriptRuntimeStatusLabel(script: ProjectScriptCheck) {
  const terminal = projectScriptTerminal(script.name);

  if (!terminal) {
    return scriptStatusLabel(script);
  }

  if (terminal.isRunning) {
    return "Running";
  }

  if (terminal.signal) {
    return "Stopped";
  }

  if (terminal.exitCode !== null && terminal.exitCode !== undefined && terminal.exitCode !== 0) {
    return "Failed";
  }

  return "Finished";
}

function openOrRunProjectScript(script: ProjectScriptCheck) {
  if (!script.present) {
    return;
  }

  if (projectScriptTerminal(script.name)) {
    emit("openTerminal", script.name);
    return;
  }

  emit("runScript", script.name);
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

function scriptDurationLabel(durationMs?: number) {
  if (durationMs === undefined) {
    return "";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

function availableProjectScripts(health: ProjectHealth) {
  return health.scripts.filter((script) => script.present);
}

function missingProjectScripts(health: ProjectHealth) {
  return health.scripts.filter((script) => !script.present);
}

function missingProjectScriptSummary(health: ProjectHealth) {
  const missingScripts = missingProjectScripts(health);

  if (missingScripts.length === 0) {
    return "";
  }

  return `${missingScripts.length} common scripts missing: ${missingScripts.map((script) => script.name).join(", ")}`;
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

      <div class="project-health-grid">
        <article class="project-health-card" :class="health.packageManager.status">
          <div class="project-health-card-heading">
            <span>Package manager</span>
            <strong>{{ healthStatusLabel(health.packageManager.status) }}</strong>
          </div>
          <dl>
            <div>
              <dt>Detected</dt>
              <dd>{{ health.packageManager.detected ?? "Unknown" }}</dd>
            </div>
            <div>
              <dt>Declared</dt>
              <dd>{{ health.packageManager.declared ?? "None" }}</dd>
            </div>
            <div>
              <dt>Lockfiles</dt>
              <dd>{{ health.packageManager.lockfiles.join(", ") || "None" }}</dd>
            </div>
          </dl>
          <ul v-if="health.packageManager.messages.length > 0" class="project-health-messages">
            <li
              v-for="entry in health.packageManager.messages"
              :key="`package-${entry.text}`"
              :class="entry.level"
            >
              {{ entry.text }}
            </li>
          </ul>
        </article>

        <article class="project-health-card" :class="health.node.status">
          <div class="project-health-card-heading">
            <span>Node</span>
            <strong>{{ healthStatusLabel(health.node.status) }}</strong>
          </div>
          <dl>
            <div>
              <dt>Current</dt>
              <dd>{{ health.node.current ?? "Unknown" }}</dd>
            </div>
            <div>
              <dt>Configured</dt>
              <dd>{{ health.node.configured ?? "None" }}</dd>
            </div>
            <div>
              <dt>Engines</dt>
              <dd>{{ health.node.engineRange ?? "None" }}</dd>
            </div>
          </dl>
          <ul v-if="health.node.messages.length > 0" class="project-health-messages">
            <li v-for="entry in health.node.messages" :key="`node-${entry.text}`" :class="entry.level">
              {{ entry.text }}
            </li>
          </ul>
        </article>

        <article class="project-health-card" :class="health.lockfile.status">
          <div class="project-health-card-heading">
            <span>Lockfile</span>
            <strong>{{ healthStatusLabel(health.lockfile.status) }}</strong>
          </div>
          <dl>
            <div>
              <dt>Present</dt>
              <dd>{{ health.lockfile.present ? "Yes" : "No" }}</dd>
            </div>
            <div>
              <dt>Dirty</dt>
              <dd>{{ health.lockfile.dirty ? "Yes" : "No" }}</dd>
            </div>
            <div>
              <dt>Stale</dt>
              <dd>{{ health.lockfile.stale ? "Yes" : "No" }}</dd>
            </div>
          </dl>
          <ul v-if="health.lockfile.messages.length > 0" class="project-health-messages">
            <li
              v-for="entry in health.lockfile.messages"
              :key="`lockfile-${entry.text}`"
              :class="entry.level"
            >
              {{ entry.text }}
            </li>
          </ul>
        </article>

        <article class="project-health-card" :class="health.install.status">
          <div class="project-health-card-heading">
            <span>Install state</span>
            <strong>{{ healthStatusLabel(health.install.status) }}</strong>
          </div>
          <dl>
            <div>
              <dt>package.json</dt>
              <dd>{{ health.packageJsonPresent ? "Found" : "Missing" }}</dd>
            </div>
            <div>
              <dt>node_modules</dt>
              <dd>{{ health.install.installed ? "Found" : "Missing" }}</dd>
            </div>
          </dl>
          <ul v-if="health.install.messages.length > 0" class="project-health-messages">
            <li
              v-for="entry in health.install.messages"
              :key="`install-${entry.text}`"
              :class="entry.level"
            >
              {{ entry.text }}
            </li>
          </ul>
        </article>
      </div>

      <section class="project-health-section">
        <div class="project-health-section-heading">
          <div>
            <span>Dependencies</span>
            <h4>{{ dependencyStatusLabel(health.dependencies) }}</h4>
          </div>
          <div class="project-health-section-actions">
            <small v-if="health.dependencies.checkedAt">
              Checked {{ healthCheckedAtLabel(health.dependencies.checkedAt) }}
            </small>
            <button
              type="button"
              class="secondary"
              :disabled="outdatedLoading || loading"
              @click="$emit('checkOutdated')"
            >
              {{ outdatedLoading ? "Checking..." : "Check outdated" }}
            </button>
          </div>
        </div>
        <div class="project-health-check-row">
          <span>Status</span>
          <strong>{{ dependencyStatusLabel(health.dependencies) }}</strong>
          <small>{{ dependencyDetailLabel(health.dependencies) }}</small>
        </div>
        <div
          v-if="health.dependencies.outdated?.length"
          class="project-health-dependency-table"
          aria-label="Outdated dependencies"
        >
          <div
            v-for="dependency in health.dependencies.outdated"
            :key="dependency.name"
            class="project-health-dependency-row"
          >
            <div>
              <strong>{{ dependency.name }}</strong>
              <small v-if="dependency.type">{{ dependency.type }}</small>
            </div>
            <span>
              {{ outdatedDependencyVersionLabel(dependency.current, dependency.wanted, dependency.latest) }}
            </span>
          </div>
        </div>
        <p
          v-if="health.dependencies.error"
          class="project-health-error compact"
        >
          {{ health.dependencies.error }}
        </p>
      </section>

      <section class="project-health-section">
        <div class="project-health-section-heading">
          <div>
            <span>Common scripts</span>
            <h4>{{ availableProjectScripts(health).length }} available</h4>
          </div>
          <div class="project-health-section-actions">
            <RunProjectHealthScriptsButton
              :health="health"
              :loading="loading"
              :script-terminals-by-script="scriptTerminalsByScript"
              @run-script="$emit('runScript', $event)"
              @restart-script="$emit('restartScript', $event)"
            />
          </div>
        </div>

        <div v-if="availableProjectScripts(health).length > 0" class="project-health-script-table">
          <div
            v-for="script in availableProjectScripts(health)"
            :key="script.name"
            class="project-health-script-row"
            :class="projectScriptRuntimeStatus(script)"
            role="button"
            tabindex="0"
            :title="projectScriptTerminal(script.name) ? 'Open terminal' : 'Run script'"
            @click="openOrRunProjectScript(script)"
            @keydown.enter="openOrRunProjectScript(script)"
            @keydown.space.prevent="openOrRunProjectScript(script)"
          >
            <div>
              <strong>{{ script.name }}</strong>
              <small>{{ script.command ?? "Missing from package.json" }}</small>
            </div>
            <span>{{ projectScriptRuntimeStatusLabel(script) }}</span>
            <time>{{ scriptDurationLabel(script.durationMs) }}</time>
            <p v-if="script.error">{{ script.error }}</p>
          </div>
        </div>
        <p v-else class="project-health-empty">No common scripts found.</p>
        <p v-if="missingProjectScriptSummary(health)" class="project-health-missing-summary">
          {{ missingProjectScriptSummary(health) }}
        </p>
      </section>
    </template>
  </section>
</template>

<style scoped>
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
