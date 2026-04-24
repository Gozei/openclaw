import fs from "node:fs/promises";
import path from "node:path";
import type { FailureRegistryEntry } from "./types.js";

const EVOLUTION_DIR = path.join("memory", ".evolution");
const FAILURES_FILE = path.join(EVOLUTION_DIR, "failures.json");
const MAX_FAILURE_ENTRIES = 500;

function normalizeSignature(value: string): string {
  return value.trim().toLowerCase();
}

function isValidTimestamp(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function sanitizeEntry(entry: FailureRegistryEntry): FailureRegistryEntry | null {
  const signature = normalizeSignature(entry.signature);
  if (!signature) {
    return null;
  }

  const count = Number.isFinite(entry.count) && entry.count > 0 ? Math.trunc(entry.count) : 1;
  const firstSeenAt = isValidTimestamp(entry.firstSeenAt) ? entry.firstSeenAt : Date.now();
  const lastSeenAt = isValidTimestamp(entry.lastSeenAt) ? entry.lastSeenAt : firstSeenAt;

  return {
    signature,
    count,
    firstSeenAt: Math.min(firstSeenAt, lastSeenAt),
    lastSeenAt: Math.max(firstSeenAt, lastSeenAt),
    lastWorkaround: entry.lastWorkaround?.trim() || undefined,
    promotedToRule: entry.promotedToRule,
    promotedToSkill: entry.promotedToSkill,
  };
}

function sortEntries(entries: FailureRegistryEntry[]): FailureRegistryEntry[] {
  return [...entries].toSorted((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    if (b.lastSeenAt !== a.lastSeenAt) {
      return b.lastSeenAt - a.lastSeenAt;
    }
    return a.signature.localeCompare(b.signature);
  });
}

function dedupeEntries(entries: FailureRegistryEntry[]): FailureRegistryEntry[] {
  const bySignature = new Map<string, FailureRegistryEntry>();

  for (const raw of entries) {
    const entry = sanitizeEntry(raw);
    if (!entry) {
      continue;
    }
    const existing = bySignature.get(entry.signature);
    if (!existing) {
      bySignature.set(entry.signature, entry);
      continue;
    }
    bySignature.set(entry.signature, {
      signature: entry.signature,
      count: existing.count + entry.count,
      firstSeenAt: Math.min(existing.firstSeenAt, entry.firstSeenAt),
      lastSeenAt: Math.max(existing.lastSeenAt, entry.lastSeenAt),
      lastWorkaround: entry.lastWorkaround ?? existing.lastWorkaround,
      promotedToRule: existing.promotedToRule || entry.promotedToRule,
      promotedToSkill: existing.promotedToSkill || entry.promotedToSkill,
    });
  }

  return sortEntries([...bySignature.values()]).slice(0, MAX_FAILURE_ENTRIES);
}

export function resolveFailureRegistryPath(workspaceDir: string): string {
  return path.join(workspaceDir, FAILURES_FILE);
}

export async function loadFailureRegistry(workspaceDir: string): Promise<FailureRegistryEntry[]> {
  const filePath = resolveFailureRegistryPath(workspaceDir);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return dedupeEntries(parsed as FailureRegistryEntry[]);
  } catch {
    return [];
  }
}

export async function saveFailureRegistry(
  workspaceDir: string,
  entries: FailureRegistryEntry[],
): Promise<void> {
  const filePath = resolveFailureRegistryPath(workspaceDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const normalized = dedupeEntries(entries);
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
}

export function upsertFailureSignatures(params: {
  entries: FailureRegistryEntry[];
  signatures: string[];
  nowMs: number;
  workaroundBySignature?: Record<string, string | undefined>;
}): FailureRegistryEntry[] {
  const next = new Map<string, FailureRegistryEntry>();

  for (const entry of dedupeEntries(params.entries)) {
    next.set(entry.signature, entry);
  }

  for (const rawSignature of params.signatures) {
    const signature = normalizeSignature(rawSignature);
    if (!signature) {
      continue;
    }
    const existing = next.get(signature);
    const workaround = params.workaroundBySignature?.[signature]?.trim() || undefined;
    if (existing) {
      next.set(signature, {
        ...existing,
        count: existing.count + 1,
        lastSeenAt: params.nowMs,
        lastWorkaround: workaround ?? existing.lastWorkaround,
      });
      continue;
    }
    next.set(signature, {
      signature,
      count: 1,
      firstSeenAt: params.nowMs,
      lastSeenAt: params.nowMs,
      lastWorkaround: workaround,
      promotedToRule: false,
      promotedToSkill: false,
    });
  }

  return dedupeEntries([...next.values()]);
}

export function toFailureCountMap(entries: FailureRegistryEntry[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const entry of entries) {
    result.set(entry.signature, entry.count);
  }
  return result;
}
