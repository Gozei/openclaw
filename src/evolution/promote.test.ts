import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPromotionCandidates } from "./promote.js";
import type { PromotionCandidate, ReflectionEvent } from "./types.js";

function makeEvent(): ReflectionEvent {
  return {
    id: "evt-promote",
    source: "task",
    createdAt: 1_700_000_000_000,
    promptSummary: "Review failures",
    outcomeSummary: "Captured follow-up learnings",
    succeeded: true,
    whatWorked: [],
    whatFailed: [],
    durableFacts: [],
    userPreferences: [],
    candidateRules: [],
    failureSignatures: [],
    confidence: 0.8,
    provenance: {},
  };
}

function makeCandidate(kind: PromotionCandidate["kind"], content: string): PromotionCandidate {
  return {
    id: `${kind}-1`,
    reflectionEventId: "evt-promote",
    kind,
    content,
    confidence: 0.8,
    noveltyScore: 0.5,
    repetitionCount: 1,
    status: "pending",
  };
}

describe("applyPromotionCandidates", () => {
  let workspaceDir = "";

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-evolution-promote-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("writes daily memory, memory, user profile, and proposal files", async () => {
    const result = await applyPromotionCandidates({
      workspaceDir,
      reflectionEvent: makeEvent(),
      candidates: [
        makeCandidate("daily_memory", "Worked: grouped failures"),
        makeCandidate("memory", "CI flakes cluster around websocket setup"),
        makeCandidate("user_profile", "Prefer short architecture summaries"),
        makeCandidate("rule_proposal", "Inspect CI checks before rerunning the full suite."),
        makeCandidate(
          "skill_proposal",
          "Title: CI triage\nTrigger: CI fails on PR\n\nSteps:\n1. Inspect checks",
        ),
      ],
    });

    const dailyPath = path.join(workspaceDir, "memory", "2023-11-14.md");
    const memoryPath = path.join(workspaceDir, "MEMORY.md");
    const userPath = path.join(workspaceDir, "USER.md");

    expect(await fs.readFile(dailyPath, "utf-8")).toContain("Worked: grouped failures");
    expect(await fs.readFile(memoryPath, "utf-8")).toContain("CI flakes cluster");
    expect(await fs.readFile(userPath, "utf-8")).toContain("Prefer short architecture summaries");
    expect(result.writtenPaths.some((filePath) => filePath.includes("proposals/rules"))).toBe(true);
    expect(result.writtenPaths.some((filePath) => filePath.includes("proposals/skills"))).toBe(
      true,
    );
    expect(
      result.writtenPaths.some((filePath) =>
        filePath.includes("skills/evolution-ci-triage/SKILL.md"),
      ),
    ).toBe(true);
  });

  it("dedupes repeated line appends", async () => {
    const event = makeEvent();
    await applyPromotionCandidates({
      workspaceDir,
      reflectionEvent: event,
      candidates: [makeCandidate("memory", "Durable fact")],
    });
    await applyPromotionCandidates({
      workspaceDir,
      reflectionEvent: event,
      candidates: [makeCandidate("memory", "Durable fact")],
    });

    const memoryPath = path.join(workspaceDir, "MEMORY.md");
    const content = await fs.readFile(memoryPath, "utf-8");
    expect(content.match(/Durable fact/g)).toHaveLength(1);
  });

  it("respects auto-promote gates", async () => {
    const result = await applyPromotionCandidates({
      workspaceDir,
      reflectionEvent: makeEvent(),
      autoPromote: {
        skill_proposal: false,
      },
      candidates: [
        makeCandidate(
          "skill_proposal",
          "Title: CI triage\nTrigger: CI fails on PR\n\nSteps:\n1. Inspect checks",
        ),
      ],
    });

    expect(result.applied).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });
});
