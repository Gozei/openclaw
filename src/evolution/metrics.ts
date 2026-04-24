import fs from "node:fs/promises";
import path from "node:path";
import type { EvolutionSource, PromotionKind, ReflectionEvent } from "./types.js";

export type EvolutionDayMetrics = {
  date: string;
  cycles: number;
  successes: number;
  failures: number;
  repeatedFailures: number;
  recoveredFailures: number;
  bySource: Record<EvolutionSource, number>;
  candidatesByKind: Record<PromotionKind, number>;
  appliedByKind: Record<PromotionKind, number>;
};

export type EvolutionMetricsState = {
  days: EvolutionDayMetrics[];
};

const EVOLUTION_DIR = path.join("memory", ".evolution");
const METRICS_FILE = path.join(EVOLUTION_DIR, "metrics.json");
const REPORTS_DIR = path.join(EVOLUTION_DIR, "reports");
const MAX_DAYS = 30;

function toDateStamp(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function createEmptyKindCounts(): Record<PromotionKind, number> {
  return {
    daily_memory: 0,
    memory: 0,
    user_profile: 0,
    rule_proposal: 0,
    skill_proposal: 0,
  };
}

function createEmptySourceCounts(): Record<EvolutionSource, number> {
  return {
    task: 0,
    subagent: 0,
    heartbeat: 0,
    compaction: 0,
  };
}

function createEmptyDay(date: string): EvolutionDayMetrics {
  return {
    date,
    cycles: 0,
    successes: 0,
    failures: 0,
    repeatedFailures: 0,
    recoveredFailures: 0,
    bySource: createEmptySourceCounts(),
    candidatesByKind: createEmptyKindCounts(),
    appliedByKind: createEmptyKindCounts(),
  };
}

function sanitizeDay(day: EvolutionDayMetrics): EvolutionDayMetrics {
  const next = createEmptyDay(day.date);
  next.cycles = Math.max(0, Math.trunc(day.cycles || 0));
  next.successes = Math.max(0, Math.trunc(day.successes || 0));
  next.failures = Math.max(0, Math.trunc(day.failures || 0));
  next.repeatedFailures = Math.max(0, Math.trunc(day.repeatedFailures || 0));
  next.recoveredFailures = Math.max(0, Math.trunc(day.recoveredFailures || 0));
  for (const key of Object.keys(next.bySource) as EvolutionSource[]) {
    next.bySource[key] = Math.max(0, Math.trunc(day.bySource?.[key] || 0));
  }
  for (const key of Object.keys(next.candidatesByKind) as PromotionKind[]) {
    next.candidatesByKind[key] = Math.max(0, Math.trunc(day.candidatesByKind?.[key] || 0));
    next.appliedByKind[key] = Math.max(0, Math.trunc(day.appliedByKind?.[key] || 0));
  }
  return next;
}

function sortDays(days: EvolutionDayMetrics[]): EvolutionDayMetrics[] {
  return [...days]
    .map(sanitizeDay)
    .toSorted((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_DAYS);
}

export function resolveEvolutionMetricsPath(workspaceDir: string): string {
  return path.join(workspaceDir, METRICS_FILE);
}

export async function loadEvolutionMetrics(workspaceDir: string): Promise<EvolutionMetricsState> {
  const filePath = resolveEvolutionMetricsPath(workspaceDir);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const days = Array.isArray((parsed as EvolutionMetricsState | undefined)?.days)
      ? (parsed as EvolutionMetricsState).days
      : [];
    return { days: sortDays(days) };
  } catch {
    return { days: [] };
  }
}

export async function saveEvolutionMetrics(
  workspaceDir: string,
  state: EvolutionMetricsState,
): Promise<void> {
  const filePath = resolveEvolutionMetricsPath(workspaceDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ days: sortDays(state.days) }, null, 2) + "\n");
}

export function recordEvolutionMetrics(params: {
  state: EvolutionMetricsState;
  event: ReflectionEvent;
  candidateKinds: PromotionKind[];
  appliedKinds: PromotionKind[];
  repeatedFailures: number;
  recoveredFailures: number;
  nowMs?: number;
}): EvolutionMetricsState {
  const date = toDateStamp(params.nowMs ?? params.event.createdAt);
  const days = sortDays(params.state.days);
  const existing = days.find((day) => day.date === date);
  const nextDay = sanitizeDay(existing ?? createEmptyDay(date));
  nextDay.cycles += 1;
  nextDay.bySource[params.event.source] += 1;
  if (params.event.succeeded) {
    nextDay.successes += 1;
  } else {
    nextDay.failures += 1;
  }
  nextDay.repeatedFailures += Math.max(0, params.repeatedFailures);
  nextDay.recoveredFailures += Math.max(0, params.recoveredFailures);
  for (const kind of params.candidateKinds) {
    nextDay.candidatesByKind[kind] += 1;
  }
  for (const kind of params.appliedKinds) {
    nextDay.appliedByKind[kind] += 1;
  }
  const nextDays = days.filter((day) => day.date !== date);
  nextDays.push(nextDay);
  return { days: sortDays(nextDays) };
}

export function buildEvolutionComparison(state: EvolutionMetricsState): {
  today?: EvolutionDayMetrics;
  yesterday?: EvolutionDayMetrics;
  summary: string[];
} {
  const days = sortDays(state.days);
  const today = days.at(-1);
  const yesterday = days.at(-2);
  if (!today) {
    return { summary: ["No evolution activity recorded yet."] };
  }
  const summary = [
    `Cycles: ${today.cycles}${yesterday ? ` vs ${yesterday.cycles} yesterday` : ""}`,
    `Successes: ${today.successes}${yesterday ? ` vs ${yesterday.successes} yesterday` : ""}`,
    `Failures: ${today.failures}${yesterday ? ` vs ${yesterday.failures} yesterday` : ""}`,
    `Repeated failures: ${today.repeatedFailures}${yesterday ? ` vs ${yesterday.repeatedFailures} yesterday` : ""}`,
    `Recovered failures: ${today.recoveredFailures}${yesterday ? ` vs ${yesterday.recoveredFailures} yesterday` : ""}`,
  ];
  return { today, yesterday, summary };
}

export async function writeEvolutionComparisonReport(
  workspaceDir: string,
  state: EvolutionMetricsState,
): Promise<string> {
  const comparison = buildEvolutionComparison(state);
  const reportDate = comparison.today?.date ?? toDateStamp(Date.now());
  const reportPath = path.join(workspaceDir, REPORTS_DIR, `${reportDate}.md`);
  const lines = [`# 进化报告 ${reportDate}`, "", ...comparison.summary.map((line) => `- ${line}`)];
  if (comparison.today) {
    lines.push(
      "",
      "## Applied Promotions",
      "",
      ...(Object.entries(comparison.today.appliedByKind) as Array<[PromotionKind, number]>).map(
        ([kind, count]) => `- ${kind}: ${count}`,
      ),
    );
  }
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${lines.join("\n")}\n`, "utf-8");
  return reportPath;
}
