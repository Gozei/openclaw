import { describe, expect, it } from "vitest";
import { toWorkflowCountMap, upsertWorkflowSuccess } from "./workflow-registry.js";

describe("workflow-registry", () => {
  it("adds a new workflow key", () => {
    const next = upsertWorkflowSuccess({
      entries: [],
      key: "CI triage::subagent",
      nowMs: 100,
      workflow: {
        title: "CI triage",
        trigger: "CI fails on PR",
        steps: ["Inspect the failing lane"],
        tools: ["exec"],
        successCriteria: ["The failing lane is isolated"],
        fallbackNotes: ["Escalate if infra is flaky"],
      },
      outcomeSummary: "Inspect the failing lane before rerunning tests.",
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      key: "ci triage::subagent",
      count: 1,
      firstSeenAt: 100,
      lastSeenAt: 100,
      title: "CI triage",
      trigger: "CI fails on PR",
      steps: ["Inspect the failing lane"],
      lastSummary: "Inspect the failing lane before rerunning tests.",
    });
  });

  it("increments an existing workflow key", () => {
    const next = upsertWorkflowSuccess({
      entries: [{ key: "ci triage::subagent", count: 1, firstSeenAt: 10, lastSeenAt: 10 }],
      key: "CI triage::subagent",
      nowMs: 50,
    });

    expect(next[0]).toMatchObject({
      key: "ci triage::subagent",
      count: 2,
      firstSeenAt: 10,
      lastSeenAt: 50,
    });
  });

  it("returns count maps by normalized key", () => {
    const counts = toWorkflowCountMap([
      { key: "ci triage::subagent", count: 2, firstSeenAt: 1, lastSeenAt: 2 },
    ]);

    expect(counts.get("ci triage::subagent")).toBe(2);
  });

  it("refreshes workflow details from the latest successful run", () => {
    const next = upsertWorkflowSuccess({
      entries: [
        {
          key: "ci triage::ci fails on pr",
          count: 1,
          firstSeenAt: 10,
          lastSeenAt: 10,
          title: "CI triage",
          trigger: "CI fails on PR",
          steps: ["Inspect the failing lane"],
        },
      ],
      key: "CI triage::CI fails on PR",
      nowMs: 50,
      workflow: {
        title: "CI triage",
        trigger: "CI fails on PR",
        steps: ["Inspect the failing lane", "Re-run only the scoped checks"],
        tools: ["exec", "github"],
        successCriteria: ["Only targeted verification is rerun"],
        fallbackNotes: [],
      },
      outcomeSummary: "Reused the targeted rerun path quickly.",
    });

    expect(next[0]).toMatchObject({
      count: 2,
      steps: ["Inspect the failing lane", "Re-run only the scoped checks"],
      tools: ["exec", "github"],
      successCriteria: ["Only targeted verification is rerun"],
      lastSummary: "Reused the targeted rerun path quickly.",
    });
  });
});
