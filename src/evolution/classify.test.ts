import { describe, expect, it } from "vitest";
import { classifyReflectionEvent } from "./classify.js";
import type { ReflectionEvent } from "./types.js";

function makeEvent(overrides: Partial<ReflectionEvent> = {}): ReflectionEvent {
  return {
    id: "evt-1",
    source: "task",
    createdAt: 1,
    promptSummary: "Fix CI",
    outcomeSummary: "Updated failing test",
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

describe("classifyReflectionEvent", () => {
  it("promotes durable facts to memory", () => {
    const candidates = classifyReflectionEvent({
      event: makeEvent({
        durableFacts: ["User prefers concise changelogs."],
      }),
    });

    expect(candidates.some((candidate) => candidate.kind === "memory")).toBe(true);
  });

  it("promotes user preferences to user_profile", () => {
    const candidates = classifyReflectionEvent({
      event: makeEvent({
        userPreferences: ["Prefer Chinese responses for architecture discussions."],
      }),
    });

    expect(candidates.some((candidate) => candidate.kind === "user_profile")).toBe(true);
  });

  it("does not create a rule proposal on first failure", () => {
    const candidates = classifyReflectionEvent({
      event: makeEvent({
        succeeded: false,
        candidateRules: ["Inspect failing CI checks before rerunning all tests."],
        failureSignatures: ["tool:ci:error:missing-check-analysis"],
      }),
      failureCounts: new Map([["tool:ci:error:missing-check-analysis", 1]]),
    });

    expect(candidates.some((candidate) => candidate.kind === "rule_proposal")).toBe(false);
  });

  it("creates a rule proposal after repeated failures", () => {
    const candidates = classifyReflectionEvent({
      event: makeEvent({
        succeeded: false,
        candidateRules: ["Inspect failing CI checks before rerunning all tests."],
        failureSignatures: ["tool:ci:error:missing-check-analysis"],
      }),
      failureCounts: new Map([["tool:ci:error:missing-check-analysis", 2]]),
    });

    expect(candidates.some((candidate) => candidate.kind === "rule_proposal")).toBe(true);
  });

  it("creates a skill proposal after repeated successful workflow reuse", () => {
    const candidates = classifyReflectionEvent({
      event: makeEvent({
        candidateWorkflow: {
          title: "CI triage",
          trigger: "CI fails on PR",
          steps: ["Inspect checks", "Group failures", "Patch smallest boundary"],
          tools: ["github", "exec"],
          successCriteria: ["Root cause identified", "Targeted verification passes"],
          fallbackNotes: ["Escalate if logs are incomplete"],
        },
      }),
      workflowReuseCounts: new Map([["CI triage::CI fails on PR", 2]]),
    });

    expect(candidates.some((candidate) => candidate.kind === "skill_proposal")).toBe(true);
  });

  it("filters provider/schema operational failures out of daily memory and rule proposals", () => {
    const candidates = classifyReflectionEvent({
      event: makeEvent({
        succeeded: false,
        outcomeSummary: "LLM request failed: provider rejected the request schema or tool payload.",
        whatFailed: ["LLM request failed: provider rejected the request schema or tool payload."],
        candidateRules: ["Retry with a different tool payload."],
        failureSignatures: ["task:subagent:failed:ci"],
      }),
      failureCounts: new Map([["task:subagent:failed:ci", 3]]),
    });

    expect(candidates.some((candidate) => candidate.kind === "daily_memory")).toBe(false);
    expect(candidates.some((candidate) => candidate.kind === "rule_proposal")).toBe(false);
  });
});
