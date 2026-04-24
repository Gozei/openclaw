import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowCandidate } from "./types.js";

export type WorkflowRegistryEntry = {
  key: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  title?: string;
  trigger?: string;
  steps?: string[];
  tools?: string[];
  successCriteria?: string[];
  fallbackNotes?: string[];
  lastSummary?: string;
};

const EVOLUTION_DIR = path.join("memory", ".evolution");
const WORKFLOWS_FILE = path.join(EVOLUTION_DIR, "workflows.json");
const MAX_WORKFLOW_ENTRIES = 500;

function normalizeWorkflowKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeLine(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function sanitizeStringList(values: string[] | undefined, maxItems = 8): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = normalizeLine(raw);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
    if (out.length >= maxItems) {
      break;
    }
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeOptionalLine(value: string | undefined): string | undefined {
  const normalized = normalizeLine(value ?? "");
  return normalized || undefined;
}

function sanitizeEntry(entry: WorkflowRegistryEntry): WorkflowRegistryEntry | null {
  const key = normalizeWorkflowKey(entry.key);
  if (!key) {
    return null;
  }
  const count = Number.isFinite(entry.count) && entry.count > 0 ? Math.trunc(entry.count) : 1;
  const firstSeenAt =
    Number.isFinite(entry.firstSeenAt) && entry.firstSeenAt > 0 ? entry.firstSeenAt : Date.now();
  const lastSeenAt =
    Number.isFinite(entry.lastSeenAt) && entry.lastSeenAt > 0 ? entry.lastSeenAt : firstSeenAt;
  return {
    key,
    count,
    firstSeenAt: Math.min(firstSeenAt, lastSeenAt),
    lastSeenAt: Math.max(firstSeenAt, lastSeenAt),
    title: sanitizeOptionalLine(entry.title),
    trigger: sanitizeOptionalLine(entry.trigger),
    steps: sanitizeStringList(entry.steps, 6),
    tools: sanitizeStringList(entry.tools, 6),
    successCriteria: sanitizeStringList(entry.successCriteria, 4),
    fallbackNotes: sanitizeStringList(entry.fallbackNotes, 4),
    lastSummary: sanitizeOptionalLine(entry.lastSummary),
  };
}

function mergeEntries(
  existing: WorkflowRegistryEntry,
  incoming: WorkflowRegistryEntry,
): WorkflowRegistryEntry {
  const newer = incoming.lastSeenAt >= existing.lastSeenAt ? incoming : existing;
  const older = newer === incoming ? existing : incoming;
  return {
    key: incoming.key,
    count: existing.count + incoming.count,
    firstSeenAt: Math.min(existing.firstSeenAt, incoming.firstSeenAt),
    lastSeenAt: Math.max(existing.lastSeenAt, incoming.lastSeenAt),
    title: newer.title ?? older.title,
    trigger: newer.trigger ?? older.trigger,
    steps: newer.steps ?? older.steps,
    tools: newer.tools ?? older.tools,
    successCriteria: newer.successCriteria ?? older.successCriteria,
    fallbackNotes: newer.fallbackNotes ?? older.fallbackNotes,
    lastSummary: newer.lastSummary ?? older.lastSummary,
  };
}

function dedupeEntries(entries: WorkflowRegistryEntry[]): WorkflowRegistryEntry[] {
  const next = new Map<string, WorkflowRegistryEntry>();
  for (const raw of entries) {
    const entry = sanitizeEntry(raw);
    if (!entry) {
      continue;
    }
    const existing = next.get(entry.key);
    if (!existing) {
      next.set(entry.key, entry);
      continue;
    }
    next.set(entry.key, mergeEntries(existing, entry));
  }
  return [...next.values()]
    .toSorted((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      if (b.lastSeenAt !== a.lastSeenAt) {
        return b.lastSeenAt - a.lastSeenAt;
      }
      return a.key.localeCompare(b.key);
    })
    .slice(0, MAX_WORKFLOW_ENTRIES);
}

export function resolveWorkflowRegistryPath(workspaceDir: string): string {
  return path.join(workspaceDir, WORKFLOWS_FILE);
}

export async function loadWorkflowRegistry(workspaceDir: string): Promise<WorkflowRegistryEntry[]> {
  const filePath = resolveWorkflowRegistryPath(workspaceDir);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? dedupeEntries(parsed as WorkflowRegistryEntry[]) : [];
  } catch {
    return [];
  }
}

export async function saveWorkflowRegistry(
  workspaceDir: string,
  entries: WorkflowRegistryEntry[],
): Promise<void> {
  const filePath = resolveWorkflowRegistryPath(workspaceDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(dedupeEntries(entries), null, 2) + "\n", "utf-8");
}

export function upsertWorkflowSuccess(params: {
  entries: WorkflowRegistryEntry[];
  key: string;
  nowMs: number;
  workflow?: WorkflowCandidate;
  outcomeSummary?: string;
}): WorkflowRegistryEntry[] {
  const key = normalizeWorkflowKey(params.key);
  if (!key) {
    return dedupeEntries(params.entries);
  }
  const next = new Map(dedupeEntries(params.entries).map((entry) => [entry.key, entry]));
  const existing = next.get(key);
  const incoming = sanitizeEntry({
    key,
    count: (existing?.count ?? 0) + 1,
    firstSeenAt: existing?.firstSeenAt ?? params.nowMs,
    lastSeenAt: params.nowMs,
    title: params.workflow?.title,
    trigger: params.workflow?.trigger,
    steps: params.workflow?.steps,
    tools: params.workflow?.tools,
    successCriteria: params.workflow?.successCriteria,
    fallbackNotes: params.workflow?.fallbackNotes,
    lastSummary: params.outcomeSummary,
  });
  if (!incoming) {
    return dedupeEntries([...next.values()]);
  }
  next.set(key, incoming);
  return dedupeEntries([...next.values()]);
}

export function toWorkflowCountMap(entries: WorkflowRegistryEntry[]): Map<string, number> {
  return new Map(entries.map((entry) => [entry.key, entry.count]));
}
