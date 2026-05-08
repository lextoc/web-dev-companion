import type { ProjectHealth, ProjectTask } from "../../../repositories";
import type { EcosystemHealthSummary } from "./healthSummaryTypes";

export function hasJavaHealth(health: ProjectHealth, javaTasks: ProjectTask[]) {
  return (
    javaTasks.length > 0 ||
    Boolean(health.java.requiredRelease) ||
    Boolean(health.java.mavenWrapperPresent) ||
    Boolean(health.java.gradleWrapperPresent)
  );
}

export function javaHealthSummary(health: ProjectHealth, javaTasks: ProjectTask[]): EcosystemHealthSummary {
  return {
    key: "java",
    present: hasJavaHealth(health, javaTasks),
    status: health.java.status,
    attentionItems: health.java.messages.map((entry) => ({
      key: `java-${entry.text}`,
      level: entry.level,
      title: "Java",
      text: entry.text,
    })),
  };
}
