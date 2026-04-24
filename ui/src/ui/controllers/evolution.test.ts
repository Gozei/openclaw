import { describe, expect, it, vi } from "vitest";
import { loadEvolutionStatus, type EvolutionState } from "./evolution.ts";

function createState(): { state: EvolutionState; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn();
  const state: EvolutionState = {
    client: {
      request,
    } as unknown as EvolutionState["client"],
    connected: true,
    evolutionLoading: false,
    evolutionError: null,
    evolutionStatus: null,
  };
  return { state, request };
}

describe("evolution controller", () => {
  it("loads and normalizes evolution status", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({
      enabled: true,
      workspaceDir: "/tmp/openclaw-agent",
      snapshot: {
        comparison: {
          summary: ["Cycles: 4 vs 2 yesterday"],
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
          content: "- Start with the failing lane first.",
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
        generatedSkills: [
          {
            title: "evolution-ci-triage",
            path: "skills/evolution-ci-triage/SKILL.md",
            updatedAt: "2026-04-23T09:10:00.000Z",
            preview: "# Purpose\n\nUse this generated skill when: CI fails on PR",
          },
        ],
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
    });

    await loadEvolutionStatus(state);

    expect(request).toHaveBeenCalledWith("doctor.memory.evolutionStatus", {});
    expect(state.evolutionStatus).toEqual(
      expect.objectContaining({
        enabled: true,
        workspaceDir: "/tmp/openclaw-agent",
        comparison: expect.objectContaining({
          summary: ["Cycles: 4 vs 2 yesterday"],
          today: expect.objectContaining({
            cycles: 4,
            repeatedFailures: 1,
          }),
        }),
        latestDailyMemory: expect.objectContaining({
          path: "memory/2026-04-23.md",
        }),
        failures: [
          expect.objectContaining({
            signature: "task:subagent:failed:ci",
            count: 2,
          }),
        ],
        workflows: [
          expect.objectContaining({
            key: "ci triage::ci fails on pr",
            title: "CI triage",
            steps: ["Inspect the failing lane first"],
          }),
        ],
        generatedSkills: [
          expect.objectContaining({
            title: "evolution-ci-triage",
            path: "skills/evolution-ci-triage/SKILL.md",
          }),
        ],
        proposals: expect.objectContaining({
          rules: [
            expect.objectContaining({
              title: "Check failing lanes first",
            }),
          ],
        }),
      }),
    );
    expect(state.evolutionError).toBeNull();
    expect(state.evolutionLoading).toBe(false);
  });
});
