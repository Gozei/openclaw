import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildEvolutionPreflight,
  buildEvolutionPreflightPrompt,
  buildEvolutionRecallNotice,
} from "./preflight.js";

describe("buildEvolutionPreflightPrompt", () => {
  let workspaceDir = "";

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-evolution-preflight-"));
    await fs.mkdir(path.join(workspaceDir, "memory", ".evolution"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "skills", "evolution-ci-triage"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "memory", ".evolution", "failures.json"),
      JSON.stringify([
        {
          signature: "task:subagent:failed:ci",
          count: 3,
          firstSeenAt: 1,
          lastSeenAt: 2,
          lastWorkaround: "Inspect the failing lane before rerunning the full suite.",
          promotedToRule: false,
          promotedToSkill: false,
        },
      ]),
      "utf-8",
    );
    await fs.writeFile(
      path.join(workspaceDir, "memory", ".evolution", "workflows.json"),
      JSON.stringify([
        {
          key: "CI triage::ci",
          count: 2,
          firstSeenAt: 1,
          lastSeenAt: 2,
          title: "CI triage",
          trigger: "CI fails on PR",
          steps: ["Inspect the failing lane first", "Re-run only the scoped tests"],
          successCriteria: ["Only targeted verification is rerun"],
          lastSummary: "Used the narrowest rerun path first.",
        },
      ]),
      "utf-8",
    );
    await fs.writeFile(
      path.join(workspaceDir, "skills", "evolution-ci-triage", "SKILL.md"),
      [
        "---",
        "name: evolution-ci-triage",
        'description: "CI triage. Use when CI fails on PRs."',
        "---",
        "",
        "# Quick Start",
        "",
        "1. Inspect the failing lane first",
        "",
        "# Workflow",
        "",
        "1. Inspect the failing lane first",
        "2. Re-run only the scoped tests",
        "",
        "# Trigger Match Signals",
        "",
        "- ci",
        "- triage",
        "- failing",
        "",
      ].join("\n"),
      "utf-8",
    );
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("surfaces relevant skills, workflows, and repeated failures", async () => {
    const result = await buildEvolutionPreflight({
      workspaceDir,
      userPrompt: "Help me fix the failing CI lane on this PR",
    });
    const prompt = result?.prompt;

    expect(prompt).toContain("## Evolution Recall");
    expect(prompt).toContain("Recommended first moves from prior experience:");
    expect(prompt).toContain("Start with recalled skill step: Inspect the failing lane first");
    expect(prompt).toContain(
      "Avoid the known failure by doing this first: Inspect the failing lane before rerunning the full suite.",
    );
    expect(prompt).toContain("evolution-ci-triage");
    expect(prompt).toContain("skills/evolution-ci-triage/SKILL.md");
    expect(prompt).toContain("Quick start: Inspect the failing lane first");
    expect(prompt).toContain(
      "Use the recent workflow start from CI triage: Inspect the failing lane first",
    );
    expect(prompt).toContain(
      "CI triage (CI fails on PR). Start with: Inspect the failing lane first",
    );
    expect(prompt).toContain("Success looks like: Only targeted verification is rerun");
    expect(prompt).toContain("Inspect the failing lane before rerunning the full suite.");
    expect(prompt).toContain("Read the matching SKILL.md before improvising");
    expect(prompt).toContain(
      "If no generated skill clearly fits, follow the matching workflow's opening steps before improvising.",
    );
    expect(result?.recall).toMatchObject({
      sourceLabel: "CI triage",
      openingMove: "Inspect the failing lane first",
      matchedSkills: [
        {
          name: "evolution-ci-triage",
          path: "skills/evolution-ci-triage/SKILL.md",
          firstCue: "Inspect the failing lane first",
        },
      ],
      matchedWorkflows: [
        {
          title: "CI triage",
          firstStep: "Inspect the failing lane first",
          successCue: "Only targeted verification is rerun",
          reuseCount: 2,
        },
      ],
      matchedFailures: [
        {
          signature: "task:subagent:failed:ci",
          workaround: "Inspect the failing lane before rerunning the full suite.",
          count: 3,
        },
      ],
    });
    expect(buildEvolutionRecallNotice(result?.recall)).toBe(
      "Recall: CI triage\nFirst move: Inspect the failing lane first",
    );
  });

  it("returns undefined when nothing relevant matches", async () => {
    const prompt = await buildEvolutionPreflightPrompt({
      workspaceDir,
      userPrompt: "Translate this release note into French",
    });

    expect(prompt).toBeUndefined();
  });
});
