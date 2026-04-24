import { resolveAgentConfig } from "../agents/agent-scope-config.js";
import type { AgentEvolutionConfig } from "../config/types.agent-defaults.js";
import type { OpenClawConfig } from "../config/types.js";

export type ResolvedEvolutionConfig = Required<AgentEvolutionConfig>;

const DEFAULT_EVOLUTION_CONFIG: ResolvedEvolutionConfig = {
  enabled: true,
  reflectOnTaskComplete: true,
  reflectOnSubagentComplete: true,
  reflectOnHeartbeat: true,
  autoPromoteDailyMemory: true,
  autoPromoteMemory: true,
  autoPromoteUserProfile: true,
  autoPromoteRules: true,
  autoPromoteSkills: true,
  minRuleRepetition: 2,
  minSkillRepetition: 2,
};

export function resolveEvolutionConfig(
  cfg: OpenClawConfig,
  agentId?: string | null,
): ResolvedEvolutionConfig {
  const defaults = cfg.agents?.defaults?.evolution;
  const scoped = agentId ? resolveAgentConfig(cfg, agentId)?.evolution : undefined;
  return {
    ...DEFAULT_EVOLUTION_CONFIG,
    ...defaults,
    ...scoped,
  };
}
