import type { ProjectHealthMessage, ProjectHealthStatus } from "../../../repositories";

export interface HealthAttentionItem {
  key: string;
  level: ProjectHealthMessage["level"];
  title: string;
  text: string;
}

export interface EcosystemHealthSummary {
  key: string;
  present: boolean;
  status: ProjectHealthStatus;
  attentionItems: HealthAttentionItem[];
}
