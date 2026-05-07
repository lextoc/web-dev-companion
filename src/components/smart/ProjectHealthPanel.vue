<script setup lang="ts">
import type {
  ProjectDependencyHealth,
  ProjectHealth,
  ProjectHealthStatus,
  ProjectScriptCheck,
  ScriptTerminal,
} from "../../repositories";
import RunProjectScriptsButton from "./RunProjectScriptsButton.vue";

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

  return terminal.isRunning ? "running" : "finished";
}

function projectScriptRuntimeStatusLabel(script: ProjectScriptCheck) {
  const terminal = projectScriptTerminal(script.name);

  if (!terminal) {
    return scriptStatusLabel(script);
  }

  return terminal.isRunning ? "Running" : "Finished";
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
            <RunProjectScriptsButton
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
