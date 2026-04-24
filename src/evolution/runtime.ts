import { classifyReflectionEvent } from "./classify.js";
import {
  loadFailureRegistry,
  saveFailureRegistry,
  toFailureCountMap,
  upsertFailureSignatures,
} from "./failure-registry.js";
import { applyPromotionCandidates } from "./promote.js";
import type { PromotionKind, ReflectionEvent } from "./types.js";

export type RunEvolutionCycleResult = {
  event: ReflectionEvent;
  failureCountBySignature: Map<string, number>;
  candidates: ReturnType<typeof classifyReflectionEvent>;
  appliedKinds: PromotionKind[];
  appliedPaths: string[];
};

export async function runEvolutionCycle(params: {
  workspaceDir: string;
  event: ReflectionEvent;
  workflowReuseCounts?: Map<string, number>;
  minRuleRepetition?: number;
  minSkillRepetition?: number;
  autoPromote?: Partial<Record<PromotionKind, boolean>>;
  nowMs?: number;
}): Promise<RunEvolutionCycleResult> {
  const registry = await loadFailureRegistry(params.workspaceDir);
  const nextRegistry = upsertFailureSignatures({
    entries: registry,
    signatures: params.event.failureSignatures,
    nowMs: params.nowMs ?? params.event.createdAt,
  });
  await saveFailureRegistry(params.workspaceDir, nextRegistry);

  const failureCountBySignature = toFailureCountMap(nextRegistry);
  const candidates = classifyReflectionEvent({
    event: params.event,
    failureCounts: failureCountBySignature,
    workflowReuseCounts: params.workflowReuseCounts,
    minRuleRepetition: params.minRuleRepetition,
    minSkillRepetition: params.minSkillRepetition,
  });
  const promotions = await applyPromotionCandidates({
    workspaceDir: params.workspaceDir,
    candidates,
    reflectionEvent: params.event,
    autoPromote: params.autoPromote,
    nowMs: params.nowMs,
  });

  return {
    event: params.event,
    failureCountBySignature,
    candidates,
    appliedKinds: promotions.applied.map((candidate) => candidate.kind),
    appliedPaths: promotions.writtenPaths,
  };
}
