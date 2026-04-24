/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderEvolution, type EvolutionProps } from "./evolution.ts";

function buildProps(overrides?: Partial<EvolutionProps>): EvolutionProps {
  return {
    loading: false,
    error: null,
    status: {
      enabled: true,
      workspaceDir: "/tmp/openclaw-agent",
      comparison: {
        summary: ["Cycles: 4 vs 2 yesterday", "Repeated failures: 1 vs 0 yesterday"],
        today: {
          date: "2026-04-23",
          cycles: 4,
          successes: 2,
          failures: 2,
          repeatedFailures: 1,
          recoveredFailures: 0,
          bySource: { task: 1, subagent: 3, heartbeat: 0, compaction: 0 },
          candidatesByKind: {
            daily_memory: 4,
            memory: 1,
            user_profile: 0,
            rule_proposal: 1,
            skill_proposal: 1,
          },
          appliedByKind: {
            daily_memory: 4,
            memory: 1,
            user_profile: 0,
            rule_proposal: 1,
            skill_proposal: 0,
          },
        },
      },
      days: [],
      latestDailyMemory: {
        path: "memory/2026-04-23.md",
        content: "- Start with the failing lane before rerunning everything.",
      },
      latestReport: {
        path: "memory/.evolution/reports/2026-04-23.md",
        content: "# 进化报告 2026-04-23",
      },
      failures: [
        {
          signature: "task:subagent:failed:ci",
          count: 2,
          firstSeenAt: 1,
          lastSeenAt: 2,
          promotedToRule: true,
          promotedToSkill: false,
        },
      ],
      workflows: [
        {
          key: "ci triage::ci fails on pr",
          count: 1,
          firstSeenAt: 3,
          lastSeenAt: 4,
          title: "CI triage",
          trigger: "CI fails on PR",
          steps: ["Inspect the failing lane first"],
          successCriteria: ["Only targeted verification is rerun"],
          lastSummary: "Used the narrowest rerun path first.",
        },
      ],
      generatedSkills: [],
      proposals: {
        rules: [
          {
            kind: "rule_proposal",
            title: "Check failing lanes first",
            path: "memory/.evolution/proposals/rules/ci.md",
            createdAt: "2026-04-23T09:05:00.000Z",
            preview: "Inspect failing checks before rerunning all tests.",
          },
        ],
        skills: [],
      },
    },
    onRefresh: () => {},
    ...overrides,
  };
}

function renderInto(props: EvolutionProps): HTMLDivElement {
  const container = document.createElement("div");
  render(renderEvolution(props), container);
  return container;
}

describe("evolution view", () => {
  it("renders metrics, excerpts, and proposals", () => {
    const container = renderInto(buildProps());
    expect(container.textContent).toContain("进化");
    expect(container.textContent).toContain("Cycles");
    expect(container.textContent).toContain("Repeated failures");
    expect(container.textContent).toContain("Latest Daily Memory");
    expect(container.textContent).toContain("Check failing lanes first");
    expect(container.textContent).toContain("CI triage");
    expect(container.textContent).toContain("Start with: Inspect the failing lane first");
    expect(container.textContent).toContain("Success cue: Only targeted verification is rerun");
  });

  it("renders an empty-state hint when no status exists", () => {
    const container = renderInto(buildProps({ status: null }));
    expect(container.textContent).toContain("No 进化 data yet");
  });
});
