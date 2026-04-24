import type { GatewayBrowserClient } from "../gateway.ts";

export type EvolutionDayMetrics = {
  date: string;
  cycles: number;
  successes: number;
  failures: number;
  repeatedFailures: number;
  recoveredFailures: number;
  bySource: Record<string, number>;
  candidatesByKind: Record<string, number>;
  appliedByKind: Record<string, number>;
};

export type EvolutionExcerpt = {
  path: string;
  content: string;
};

export type EvolutionProposal = {
  kind: "rule_proposal" | "skill_proposal";
  title: string;
  path: string;
  createdAt?: string;
  preview: string;
};

export type EvolutionGeneratedSkill = {
  title: string;
  path: string;
  updatedAt?: string;
  preview: string;
};

export type EvolutionFailure = {
  signature: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastWorkaround?: string;
  promotedToRule: boolean;
  promotedToSkill: boolean;
};

export type EvolutionWorkflow = {
  key: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  title?: string;
  trigger?: string;
  steps?: string[];
  successCriteria?: string[];
  lastSummary?: string;
};

export type EvolutionStatus = {
  enabled: boolean;
  workspaceDir: string | null;
  comparison: {
    summary: string[];
    today?: EvolutionDayMetrics;
    yesterday?: EvolutionDayMetrics;
  };
  days: EvolutionDayMetrics[];
  latestDailyMemory: EvolutionExcerpt | null;
  latestReport: EvolutionExcerpt | null;
  failures: EvolutionFailure[];
  workflows: EvolutionWorkflow[];
  generatedSkills: EvolutionGeneratedSkill[];
  proposals: {
    rules: EvolutionProposal[];
    skills: EvolutionProposal[];
  };
};

type EvolutionStatusPayload = {
  enabled?: unknown;
  workspaceDir?: unknown;
  snapshot?: unknown;
};

type EvolutionSnapshotPayload = {
  comparison?: unknown;
  days?: unknown;
  latestDailyMemory?: unknown;
  latestReport?: unknown;
  failures?: unknown;
  workflows?: unknown;
  generatedSkills?: unknown;
  proposals?: unknown;
};

type EvolutionComparisonPayload = {
  summary?: unknown;
  today?: unknown;
  yesterday?: unknown;
};

type EvolutionProposalBucketsPayload = {
  rules?: unknown;
  skills?: unknown;
};

export type EvolutionState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  evolutionLoading: boolean;
  evolutionError: string | null;
  evolutionStatus: EvolutionStatus | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  const raw = asRecord(value);
  if (!raw) {
    return {};
  }
  return Object.fromEntries(Object.entries(raw).map(([key, entry]) => [key, asNumber(entry)]));
}

function normalizeDay(value: unknown): EvolutionDayMetrics | null {
  const raw = asRecord(value);
  const date = asString(raw?.date);
  if (!date) {
    return null;
  }
  return {
    date,
    cycles: asNumber(raw?.cycles),
    successes: asNumber(raw?.successes),
    failures: asNumber(raw?.failures),
    repeatedFailures: asNumber(raw?.repeatedFailures),
    recoveredFailures: asNumber(raw?.recoveredFailures),
    bySource: normalizeNumberRecord(raw?.bySource),
    candidatesByKind: normalizeNumberRecord(raw?.candidatesByKind),
    appliedByKind: normalizeNumberRecord(raw?.appliedByKind),
  };
}

function normalizeExcerpt(value: unknown): EvolutionExcerpt | null {
  const raw = asRecord(value);
  const path = asString(raw?.path);
  const content = asString(raw?.content);
  if (!path || !content) {
    return null;
  }
  return { path, content };
}

function normalizeFailure(value: unknown): EvolutionFailure | null {
  const raw = asRecord(value);
  const signature = asString(raw?.signature);
  if (!signature) {
    return null;
  }
  return {
    signature,
    count: asNumber(raw?.count),
    firstSeenAt: asNumber(raw?.firstSeenAt),
    lastSeenAt: asNumber(raw?.lastSeenAt),
    lastWorkaround: asString(raw?.lastWorkaround) ?? undefined,
    promotedToRule: asBoolean(raw?.promotedToRule),
    promotedToSkill: asBoolean(raw?.promotedToSkill),
  };
}

function normalizeWorkflow(value: unknown): EvolutionWorkflow | null {
  const raw = asRecord(value);
  const key = asString(raw?.key);
  if (!key) {
    return null;
  }
  const steps = asArray<string>(raw?.steps).filter(
    (entry): entry is string => typeof entry === "string",
  );
  const successCriteria = asArray<string>(raw?.successCriteria).filter(
    (entry): entry is string => typeof entry === "string",
  );
  return {
    key,
    count: asNumber(raw?.count),
    firstSeenAt: asNumber(raw?.firstSeenAt),
    lastSeenAt: asNumber(raw?.lastSeenAt),
    title: asString(raw?.title) ?? undefined,
    trigger: asString(raw?.trigger) ?? undefined,
    steps: steps.length > 0 ? steps : undefined,
    successCriteria: successCriteria.length > 0 ? successCriteria : undefined,
    lastSummary: asString(raw?.lastSummary) ?? undefined,
  };
}

function normalizeProposal(value: unknown): EvolutionProposal | null {
  const raw = asRecord(value);
  const kind = asString(raw?.kind);
  const title = asString(raw?.title);
  const path = asString(raw?.path);
  const preview = asString(raw?.preview);
  if ((kind !== "rule_proposal" && kind !== "skill_proposal") || !title || !path || !preview) {
    return null;
  }
  return {
    kind,
    title,
    path,
    createdAt: asString(raw?.createdAt) ?? undefined,
    preview,
  };
}

function normalizeGeneratedSkill(value: unknown): EvolutionGeneratedSkill | null {
  const raw = asRecord(value);
  const title = asString(raw?.title);
  const path = asString(raw?.path);
  const preview = asString(raw?.preview);
  if (!title || !path || !preview) {
    return null;
  }
  return {
    title,
    path,
    updatedAt: asString(raw?.updatedAt) ?? undefined,
    preview,
  };
}

function normalizeStatus(payload: EvolutionStatusPayload): EvolutionStatus {
  const snapshot = asRecord(payload.snapshot) as EvolutionSnapshotPayload | null;
  const comparison = asRecord(snapshot?.comparison) as EvolutionComparisonPayload | null;
  return {
    enabled: asBoolean(payload.enabled),
    workspaceDir: asString(payload.workspaceDir),
    comparison: {
      summary: asArray<string>(comparison?.summary).filter(
        (value): value is string => typeof value === "string",
      ),
      today: normalizeDay(comparison?.today ?? null) ?? undefined,
      yesterday: normalizeDay(comparison?.yesterday ?? null) ?? undefined,
    },
    days: asArray(snapshot?.days)
      .map((entry) => normalizeDay(entry))
      .filter((entry): entry is EvolutionDayMetrics => entry !== null),
    latestDailyMemory: normalizeExcerpt(snapshot?.latestDailyMemory ?? null),
    latestReport: normalizeExcerpt(snapshot?.latestReport ?? null),
    failures: asArray(snapshot?.failures)
      .map((entry) => normalizeFailure(entry))
      .filter((entry): entry is EvolutionFailure => entry !== null),
    workflows: asArray(snapshot?.workflows)
      .map((entry) => normalizeWorkflow(entry))
      .filter((entry): entry is EvolutionWorkflow => entry !== null),
    generatedSkills: asArray(snapshot?.generatedSkills)
      .map((entry) => normalizeGeneratedSkill(entry))
      .filter((entry): entry is EvolutionGeneratedSkill => entry !== null),
    proposals: {
      rules: asArray(
        (asRecord(snapshot?.proposals) as EvolutionProposalBucketsPayload | null)?.rules,
      )
        .map((entry) => normalizeProposal(entry))
        .filter((entry): entry is EvolutionProposal => entry !== null),
      skills: asArray(
        (asRecord(snapshot?.proposals) as EvolutionProposalBucketsPayload | null)?.skills,
      )
        .map((entry) => normalizeProposal(entry))
        .filter((entry): entry is EvolutionProposal => entry !== null),
    },
  };
}

export async function loadEvolutionStatus(state: EvolutionState): Promise<void> {
  if (!state.client || !state.connected || state.evolutionLoading) {
    return;
  }
  state.evolutionLoading = true;
  state.evolutionError = null;
  try {
    const payload = await state.client.request<EvolutionStatusPayload | null>(
      "doctor.memory.evolutionStatus",
      {},
    );
    if (payload) {
      state.evolutionStatus = normalizeStatus(payload);
    }
  } catch (err) {
    state.evolutionError = String(err);
  } finally {
    state.evolutionLoading = false;
  }
}
