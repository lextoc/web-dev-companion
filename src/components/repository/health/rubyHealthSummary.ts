import type { ProjectTask } from "../../../repositories";
import type { EcosystemHealthSummary } from "./healthSummaryTypes";

export function hasRubyHealth(rubyTasks: ProjectTask[]) {
  return rubyTasks.length > 0;
}

export function rubyHealthSummary(rubyTasks: ProjectTask[]): EcosystemHealthSummary {
  return {
    key: "ruby",
    present: hasRubyHealth(rubyTasks),
    status: "ok",
    attentionItems: [],
  };
}
