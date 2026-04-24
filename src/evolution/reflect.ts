import crypto from "node:crypto";
import type { EvolutionSource, ReflectionEvent, ReflectionProvenance } from "./types.js";

export type BuildReflectionEventParams = {
  source: EvolutionSource;
  sessionKey?: string;
  taskId?: string;
  subagentId?: string;
  promptSummary: string;
  outcomeSummary: string;
  succeeded: boolean;
  whatWorked?: string[];
  whatFailed?: string[];
  durableFacts?: string[];
  userPreferences?: string[];
  candidateRules?: string[];
  failureSignatures?: string[];
  candidateWorkflow?: ReflectionEvent["candidateWorkflow"];
  confidence?: number;
  provenance?: ReflectionProvenance;
  nowMs?: number;
};

function normalizeLine(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function uniqueNonEmpty(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = normalizeLine(raw);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function clampConfidence(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0.75;
  }
  return Math.min(1, Math.max(0, value as number));
}

function stableEventId(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

export function buildReflectionEvent(params: BuildReflectionEventParams): ReflectionEvent {
  const createdAt = params.nowMs ?? Date.now();
  const promptSummary = normalizeLine(params.promptSummary);
  const outcomeSummary = normalizeLine(params.outcomeSummary);
  const whatWorked = uniqueNonEmpty(params.whatWorked);
  const whatFailed = uniqueNonEmpty(params.whatFailed);
  const durableFacts = uniqueNonEmpty(params.durableFacts);
  const userPreferences = uniqueNonEmpty(params.userPreferences);
  const candidateRules = uniqueNonEmpty(params.candidateRules);
  const failureSignatures = uniqueNonEmpty(params.failureSignatures).map((signature) =>
    signature.toLowerCase(),
  );

  const eventId = stableEventId([
    params.source,
    params.sessionKey ?? "",
    params.taskId ?? "",
    params.subagentId ?? "",
    promptSummary,
    outcomeSummary,
    String(createdAt),
  ]);

  return {
    id: eventId,
    source: params.source,
    createdAt,
    sessionKey: params.sessionKey,
    taskId: params.taskId,
    subagentId: params.subagentId,
    promptSummary,
    outcomeSummary,
    succeeded: params.succeeded,
    whatWorked,
    whatFailed,
    durableFacts,
    userPreferences,
    candidateRules,
    failureSignatures,
    candidateWorkflow: params.candidateWorkflow,
    confidence: clampConfidence(params.confidence),
    provenance: params.provenance ?? {},
  };
}
