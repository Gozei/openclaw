import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildEvolutionComparison,
  recordEvolutionMetrics,
  writeEvolutionComparisonReport,
} from "./metrics.js";
import type { ReflectionEvent } from "./types.js";

function makeEvent(overrides: Partial<ReflectionEvent> = {}): ReflectionEvent {
  return {
    id: "evt-metrics",
    source: "task",
    createdAt: Date.parse("2026-04-23T08:00:00.000Z"),
    promptSummary: "Debug CI",
    outcomeSummary: "Captured a reusable workflow",
    succeeded: true,
    whatWorked: [],
    whatFailed: [],
    durableFacts: [],
    userPreferences: [],
    candidateRules: [],
    failureSignatures: [],
    confidence: 0.8,
    provenance: {},
    ...overrides,
  };
}

describe("evolution metrics", () => {
  let workspaceDir = "";

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-evolution-metrics-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("records daily metrics and compares today vs yesterday", () => {
    const yesterday = recordEvolutionMetrics({
      state: { days: [] },
      event: makeEvent({
        id: "evt-yesterday",
        createdAt: Date.parse("2026-04-22T08:00:00.000Z"),
        succeeded: false,
        failureSignatures: ["task:cli:failed:ci"],
      }),
      candidateKinds: ["daily_memory"],
      appliedKinds: ["daily_memory"],
      repeatedFailures: 1,
      recoveredFailures: 0,
    });
    const state = recordEvolutionMetrics({
      state: yesterday,
      event: makeEvent(),
      candidateKinds: ["memory", "skill_proposal"],
      appliedKinds: ["memory"],
      repeatedFailures: 0,
      recoveredFailures: 0,
    });

    const comparison = buildEvolutionComparison(state);
    expect(comparison.today?.date).toBe("2026-04-23");
    expect(comparison.yesterday?.date).toBe("2026-04-22");
    expect(comparison.summary[0]).toContain("Cycles:");
    expect(comparison.today?.appliedByKind.memory).toBe(1);
  });

  it("writes a markdown comparison report", async () => {
    const state = recordEvolutionMetrics({
      state: { days: [] },
      event: makeEvent(),
      candidateKinds: ["memory"],
      appliedKinds: ["memory"],
      repeatedFailures: 0,
      recoveredFailures: 0,
    });

    const reportPath = await writeEvolutionComparisonReport(workspaceDir, state);
    const content = await fs.readFile(reportPath, "utf-8");

    expect(content).toContain("# 进化报告 2026-04-23");
    expect(content).toContain("- memory: 1");
  });
});
