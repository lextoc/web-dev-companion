import type { ProjectHealth, ProjectHealthStatus, ProjectTask } from "../../../repositories";
import type { EcosystemHealthSummary, HealthAttentionItem } from "./healthSummaryTypes";

export function hasNodeHealth(health: ProjectHealth, nodeTasks: ProjectTask[]) {
  return (
    nodeTasks.length > 0 ||
    Boolean(health.packageJsonPresent) ||
    Boolean(health.packageManager.detected) ||
    Boolean(health.node.configured) ||
    Boolean(health.node.engineRange)
  );
}

function groupedNodeAttentionItems(health: ProjectHealth): HealthAttentionItem[] {
  return [
    { key: "package", title: "Package manager", messages: health.packageManager.messages },
    { key: "node", title: "Node", messages: health.node.messages },
    { key: "install", title: "Install state", messages: health.install.messages },
    { key: "lockfile", title: "Lockfile", messages: health.lockfile.messages },
  ].flatMap((group) =>
    group.messages.map((entry) => ({
      key: `${group.key}-${entry.text}`,
      level: entry.level,
      title: group.title,
      text: entry.text,
    })),
  );
}

function dependencyAttentionItems(health: ProjectHealth): HealthAttentionItem[] {
  if (health.dependencies.status === "outdated") {
    return [{
      key: "dependencies-outdated",
      level: "warning",
      title: "Dependencies",
      text: `${health.dependencies.outdatedCount ?? 0} outdated dependencies found.`,
    }];
  }

  if (health.dependencies.status === "failed") {
    return [{
      key: "dependencies-failed",
      level: "error",
      title: "Dependencies",
      text: health.dependencies.error ?? "Outdated dependency check failed.",
    }];
  }

  return [];
}

function scriptAttentionItems(health: ProjectHealth): HealthAttentionItem[] {
  return health.scripts
    .filter((entry) => ["failed", "timed-out"].includes(entry.status))
    .map((script) => ({
      key: `script-${script.name}`,
      level: "error",
      title: script.name,
      text: script.error ?? "Common script failed.",
    }));
}

function nodeHealthStatus(health: ProjectHealth): ProjectHealthStatus {
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

export function nodeHealthSummary(health: ProjectHealth, nodeTasks: ProjectTask[]): EcosystemHealthSummary {
  return {
    key: "node",
    present: hasNodeHealth(health, nodeTasks),
    status: nodeHealthStatus(health),
    attentionItems: [
      ...groupedNodeAttentionItems(health),
      ...dependencyAttentionItems(health),
      ...scriptAttentionItems(health),
    ],
  };
}
