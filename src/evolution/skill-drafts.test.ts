import { describe, expect, it } from "vitest";
import { buildGeneratedSkillMarkdown, parseWorkflowProposal } from "./skill-drafts.js";
import type { ReflectionEvent } from "./types.js";

const event: ReflectionEvent = {
  id: "evt-skill",
  source: "task",
  createdAt: 1_700_000_000_000,
  promptSummary: "Fix CI quickly",
  outcomeSummary: "Captured a stable CI triage routine",
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

describe("skill drafts", () => {
  it("parses workflow proposals", () => {
    const parsed = parseWorkflowProposal(
      [
        "Title: CI triage",
        "Trigger: CI fails on PR",
        "",
        "Steps:",
        "1. Inspect the failing lane",
        "2. Re-run only the scoped tests",
        "",
        "Tools:",
        "- exec",
        "",
        "Success Criteria:",
        "- The failing lane is isolated",
        "",
        "Fallback Notes:",
        "- Escalate if infra is flaky",
      ].join("\n"),
    );

    expect(parsed).toEqual({
      title: "CI triage",
      trigger: "CI fails on PR",
      steps: ["Inspect the failing lane", "Re-run only the scoped tests"],
      tools: ["exec"],
      successCriteria: ["The failing lane is isolated"],
      fallbackNotes: ["Escalate if infra is flaky"],
    });
  });

  it("builds a workspace skill draft from a proposal", () => {
    const draft = buildGeneratedSkillMarkdown({
      proposalContent: [
        "Title: CI triage",
        "Trigger: CI fails on PR",
        "",
        "Steps:",
        "1. Inspect the failing lane",
      ].join("\n"),
      reflectionEvent: event,
    });

    expect(draft?.skillName).toBe("evolution-ci-triage");
    expect(draft?.markdown).toContain("name: evolution-ci-triage");
    expect(draft?.markdown).toContain(
      'description: "CI triage. Use when CI fails on PR. Start with: Inspect the failing lane."',
    );
    expect(draft?.markdown).toContain("Use this generated skill when: CI fails on PR");
    expect(draft?.markdown).toContain("# Quick Start");
    expect(draft?.markdown).toContain("# Trigger Match Signals");
    expect(draft?.markdown).toContain("- triage");
    expect(draft?.markdown).toContain("Generated from reflection event `evt-skill`.");
  });
});
