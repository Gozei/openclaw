import crypto from "node:crypto";
import { filterOperationalFailureNoise, isOperationalFailureNoise } from "./noise.js";
import type { PromotionCandidate, ReflectionEvent } from "./types.js";

export type ClassifyReflectionParams = {
  event: ReflectionEvent;
  failureCounts?: Map<string, number>;
  workflowReuseCounts?: Map<string, number>;
  minRuleRepetition?: number;
  minSkillRepetition?: number;
};

const DEFAULT_MIN_RULE_REPETITION = 2;
const DEFAULT_MIN_SKILL_REPETITION = 2;

function stableId(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

function normalizeLine(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeWorkflowLookupKey(value: string): string {
  return normalizeLine(value).toLowerCase();
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = normalizeLine(raw);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function buildCandidate(params: {
  reflectionEventId: string;
  kind: PromotionCandidate["kind"];
  content: string;
  confidence: number;
  repetitionCount?: number;
  noveltyScore?: number;
}): PromotionCandidate {
  return {
    id: stableId([params.reflectionEventId, params.kind, params.content]),
    reflectionEventId: params.reflectionEventId,
    kind: params.kind,
    content: params.content,
    confidence: params.confidence,
    noveltyScore: params.noveltyScore ?? 0.5,
    repetitionCount: params.repetitionCount ?? 1,
    status: "pending",
  };
}

function classifyFacts(event: ReflectionEvent): PromotionCandidate[] {
  return uniqueNonEmpty(event.durableFacts).map((fact) =>
    buildCandidate({
      reflectionEventId: event.id,
      kind: "memory",
      content: fact,
      confidence: Math.max(0.7, event.confidence),
    }),
  );
}

function classifyUserPreferences(event: ReflectionEvent): PromotionCandidate[] {
  return uniqueNonEmpty(event.userPreferences).map((preference) =>
    buildCandidate({
      reflectionEventId: event.id,
      kind: "user_profile",
      content: preference,
      confidence: Math.max(0.75, event.confidence),
    }),
  );
}

function classifyDailyMemory(event: ReflectionEvent): PromotionCandidate[] {
  const lines = [
    ...uniqueNonEmpty(event.whatWorked).map((line) => `Worked: ${line}`),
    ...uniqueNonEmpty(filterOperationalFailureNoise(event.whatFailed)).map(
      (line) => `Failed: ${line}`,
    ),
  ];

  return lines.map((line) =>
    buildCandidate({
      reflectionEventId: event.id,
      kind: "daily_memory",
      content: line,
      confidence: 0.6,
    }),
  );
}

function classifyRuleProposals(params: {
  event: ReflectionEvent;
  failureCounts: Map<string, number>;
  minRuleRepetition: number;
}): PromotionCandidate[] {
  if (isOperationalFailureNoise(params.event.outcomeSummary)) {
    return [];
  }
  const repeatedFailure = uniqueNonEmpty(params.event.failureSignatures).some((signature) => {
    const count = params.failureCounts.get(signature) ?? 1;
    return count >= params.minRuleRepetition;
  });

  if (!repeatedFailure) {
    return [];
  }

  return uniqueNonEmpty(params.event.candidateRules).map((rule) =>
    buildCandidate({
      reflectionEventId: params.event.id,
      kind: "rule_proposal",
      content: rule,
      confidence: Math.max(0.7, params.event.confidence),
      repetitionCount: params.minRuleRepetition,
    }),
  );
}

function classifySkillProposal(params: {
  event: ReflectionEvent;
  workflowReuseCounts: Map<string, number>;
  minSkillRepetition: number;
}): PromotionCandidate[] {
  const workflow = params.event.candidateWorkflow;
  if (!workflow) {
    return [];
  }

  const key = `${workflow.title}::${workflow.trigger}`;
  const repetitionCount =
    params.workflowReuseCounts.get(key) ??
    params.workflowReuseCounts.get(normalizeWorkflowLookupKey(key)) ??
    (params.event.succeeded ? 1 : 0);

  if (!params.event.succeeded || repetitionCount < params.minSkillRepetition) {
    return [];
  }

  const body = [
    `Title: ${workflow.title}`,
    `Trigger: ${workflow.trigger}`,
    "",
    "Steps:",
    ...workflow.steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Tools:",
    ...workflow.tools.map((tool) => `- ${tool}`),
    "",
    "Success Criteria:",
    ...workflow.successCriteria.map((criterion) => `- ${criterion}`),
    "",
    "Fallback Notes:",
    ...workflow.fallbackNotes.map((note) => `- ${note}`),
  ].join("\n");

  return [
    buildCandidate({
      reflectionEventId: params.event.id,
      kind: "skill_proposal",
      content: body,
      confidence: Math.max(0.75, params.event.confidence),
      repetitionCount,
    }),
  ];
}

export function classifyReflectionEvent(params: ClassifyReflectionParams): PromotionCandidate[] {
  const failureCounts = params.failureCounts ?? new Map<string, number>();
  const workflowReuseCounts = params.workflowReuseCounts ?? new Map<string, number>();
  const minRuleRepetition = params.minRuleRepetition ?? DEFAULT_MIN_RULE_REPETITION;
  const minSkillRepetition = params.minSkillRepetition ?? DEFAULT_MIN_SKILL_REPETITION;

  const candidates = [
    ...classifyFacts(params.event),
    ...classifyUserPreferences(params.event),
    ...classifyDailyMemory(params.event),
    ...classifyRuleProposals({
      event: params.event,
      failureCounts,
      minRuleRepetition,
    }),
    ...classifySkillProposal({
      event: params.event,
      workflowReuseCounts,
      minSkillRepetition,
    }),
  ];

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kind}::${candidate.content}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
