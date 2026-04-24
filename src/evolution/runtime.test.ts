import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runEvolutionCycle } from "./runtime.js";
import type { ReflectionEvent } from "./types.js";

function makeEvent(overrides: Partial<ReflectionEvent> = {}): ReflectionEvent {
  return {
    id: "evt-runtime",
    source: "task",
    createdAt: 1_700_000_000_000,
    promptSummary: "Debug flaky CI",
    outcomeSummary: "Reduced triage time",
    succeeded: false,
    whatWorked: ["Focused on check output first"],
    whatFailed: ["Reran too broad a lane"],
    durableFacts: ["CI failures often start in websocket smoke tests"],
    userPreferences: ["Prefer terse postmortems"],
    candidateRules: ["Inspect failing checks before rerunning all tests."],
    failureSignatures: ["tool:ci:error:missing-check-analysis"],
    confidence: 0.8,
    provenance: {},
    ...overrides,
  };
}

describe("runEvolutionCycle", () => {
  let workspaceDir = "";

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-evolution-runtime-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("persists failure counts and applies promotions", async () => {
    const first = await runEvolutionCycle({
      workspaceDir,
      event: makeEvent(),
    });

    expect(first.failureCountBySignature.get("tool:ci:error:missing-check-analysis")).toBe(1);
    expect(first.appliedPaths.some((filePath) => filePath.endsWith("MEMORY.md"))).toBe(true);
    expect(first.appliedKinds).toContain("memory");

    const second = await runEvolutionCycle({
      workspaceDir,
      event: makeEvent({ id: "evt-runtime-2" }),
    });

    expect(second.failureCountBySignature.get("tool:ci:error:missing-check-analysis")).toBe(2);
    expect(second.candidates.some((candidate) => candidate.kind === "rule_proposal")).toBe(true);
    expect(second.appliedKinds).toContain("rule_proposal");
  });
});
