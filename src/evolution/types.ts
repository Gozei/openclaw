export type EvolutionSource = "task" | "subagent" | "heartbeat" | "compaction";

export type WorkflowCandidate = {
  title: string;
  trigger: string;
  steps: string[];
  tools: string[];
  successCriteria: string[];
  fallbackNotes: string[];
};

export type ReflectionProvenance = {
  sourceFiles?: string[];
  artifactPaths?: string[];
  messageCount?: number;
};

export type ReflectionEvent = {
  id: string;
  source: EvolutionSource;
  createdAt: number;
  sessionKey?: string;
  taskId?: string;
  subagentId?: string;
  promptSummary: string;
  outcomeSummary: string;
  succeeded: boolean;
  whatWorked: string[];
  whatFailed: string[];
  durableFacts: string[];
  userPreferences: string[];
  candidateRules: string[];
  failureSignatures: string[];
  candidateWorkflow?: WorkflowCandidate;
  confidence: number;
  provenance: ReflectionProvenance;
};

export type PromotionKind =
  | "daily_memory"
  | "memory"
  | "user_profile"
  | "rule_proposal"
  | "skill_proposal";

export type PromotionCandidateStatus = "pending" | "applied" | "rejected";

export type PromotionCandidate = {
  id: string;
  reflectionEventId: string;
  kind: PromotionKind;
  content: string;
  confidence: number;
  noveltyScore: number;
  repetitionCount: number;
  status: PromotionCandidateStatus;
};

export type FailureRegistryEntry = {
  signature: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastWorkaround?: string;
  promotedToRule: boolean;
  promotedToSkill: boolean;
};

export type StoredProposal = {
  id: string;
  kind: "rule_proposal" | "skill_proposal";
  title: string;
  body: string;
  createdAt: number;
  reflectionEventId: string;
};

export type ApplyPromotionsResult = {
  applied: PromotionCandidate[];
  rejected: PromotionCandidate[];
  writtenPaths: string[];
};
