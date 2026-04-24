import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConfigRuntimeState, setRuntimeConfigSnapshot } from "../config/io.js";
import type { TaskRecord } from "../tasks/task-registry.types.js";
import {
  maybeTriggerEvolutionForEvent,
  maybeTriggerEvolutionForReplyRun,
  maybeTriggerEvolutionForTasks,
} from "./auto.js";
import { buildReflectionEvent } from "./reflect.js";

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskId: "task-evolution",
    runtime: "subagent",
    taskKind: "ci",
    requesterSessionKey: "agent:main:main",
    childSessionKey: "agent:main:subagent:123",
    ownerKey: "agent:main:main",
    scopeKind: "session",
    agentId: "main",
    runId: "run-evolution",
    label: "CI triage",
    task: "Inspect the failing CI lane",
    status: "failed",
    deliveryStatus: "pending",
    notifyPolicy: "done_only",
    createdAt: Date.parse("2026-04-23T08:00:00.000Z"),
    endedAt: Date.parse("2026-04-23T08:05:00.000Z"),
    terminalSummary: "Failed after retrying the full suite without checking the failing lane first",
    error: "Missing targeted triage",
    ...overrides,
  };
}

async function waitForPath(targetPath: string): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    try {
      await fs.access(targetPath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`Timed out waiting for ${targetPath}`);
}

describe("evolution auto hook", () => {
  let workspaceDir = "";

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-evolution-auto-"));
    setRuntimeConfigSnapshot({
      agents: {
        defaults: {
          workspace: workspaceDir,
        },
      },
    });
  });

  afterEach(async () => {
    resetConfigRuntimeState();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("writes metrics and reports for detached-task evolution", async () => {
    maybeTriggerEvolutionForTasks([
      makeTask({
        taskId: "task-success",
        runId: "run-success",
        status: "succeeded",
        terminalSummary: "Grouped failing checks and captured a clean recovery path",
        error: undefined,
        terminalOutcome: "succeeded",
      }),
    ]);

    const metricsPath = path.join(workspaceDir, "memory", ".evolution", "metrics.json");
    const reportPath = path.join(workspaceDir, "memory", ".evolution", "reports", "2026-04-23.md");
    await waitForPath(metricsPath);
    await waitForPath(reportPath);

    expect(await fs.readFile(metricsPath, "utf-8")).toContain('"cycles": 1');
    expect(await fs.readFile(reportPath, "utf-8")).toContain("# 进化报告 2026-04-23");
  });

  it("creates rule proposals after repeated detached-task failures", async () => {
    maybeTriggerEvolutionForTasks([makeTask({ taskId: "task-1", runId: "run-1" })]);
    maybeTriggerEvolutionForTasks([makeTask({ taskId: "task-2", runId: "run-2" })]);

    const proposalDir = path.join(workspaceDir, "memory", ".evolution", "proposals", "rules");
    await waitForPath(proposalDir);
    const files = await fs.readdir(proposalDir);

    expect(files.length).toBeGreaterThan(0);
  });

  it("records main-session replies without detached tasks", async () => {
    maybeTriggerEvolutionForReplyRun({
      cfg: {
        agents: {
          defaults: {
            workspace: workspaceDir,
          },
        },
      },
      sessionKey: "agent:main:main",
      agentId: "main",
      workspaceDir,
      promptSummary: "Summarize the CI fix plan",
      reply: {
        text: "Start with the failing lane, isolate the regression, then rerun only the targeted checks.",
      },
    });

    const reportDate = new Date().toISOString().slice(0, 10);
    const dailyPath = path.join(workspaceDir, "memory", `${reportDate}.md`);
    const metricsPath = path.join(workspaceDir, "memory", ".evolution", "metrics.json");
    const workflowsPath = path.join(workspaceDir, "memory", ".evolution", "workflows.json");
    await waitForPath(dailyPath);
    await waitForPath(metricsPath);
    await waitForPath(workflowsPath);

    expect(await fs.readFile(dailyPath, "utf-8")).toContain(
      "Start with the failing lane, isolate the regression",
    );
    expect(await fs.readFile(metricsPath, "utf-8")).toContain('"task": 1');
    expect(await fs.readFile(workflowsPath, "utf-8")).toContain(
      "summarize the ci fix plan::ci fails or verification regresses",
    );
  });

  it("promotes repeated reply workflows into skill proposals", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
        },
      },
    };
    const promptSummary =
      "Inspect the failing CI lane on this PR and avoid rerunning the whole suite blindly.";
    const reply =
      "Start with the failing lane, inspect the check output, isolate the regression, then rerun only the targeted checks.";

    maybeTriggerEvolutionForReplyRun({
      cfg,
      sessionKey: "agent:main:main",
      agentId: "main",
      workspaceDir,
      promptSummary,
      reply: { text: reply },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    maybeTriggerEvolutionForReplyRun({
      cfg,
      sessionKey: "agent:main:main",
      agentId: "main",
      workspaceDir,
      promptSummary,
      reply: { text: reply },
    });

    const proposalDir = path.join(workspaceDir, "memory", ".evolution", "proposals", "skills");
    await waitForPath(proposalDir);
    const files = await fs.readdir(proposalDir);

    expect(files.length).toBeGreaterThan(0);
  });

  it("filters provider/schema operational failures out of future daily memory", async () => {
    maybeTriggerEvolutionForTasks([
      makeTask({
        taskId: "task-noise",
        runId: "run-noise",
        status: "failed",
        terminalSummary:
          "LLM request failed: provider rejected the request schema or tool payload.",
        error: "LLM request failed: provider rejected the request schema or tool payload.",
      }),
    ]);

    const reportDate = "2026-04-23";
    const dailyPath = path.join(workspaceDir, "memory", `${reportDate}.md`);
    const metricsPath = path.join(workspaceDir, "memory", ".evolution", "metrics.json");
    await waitForPath(metricsPath);

    await expect(fs.access(dailyPath)).rejects.toThrow();
  });

  it("records direct compaction evolution events", async () => {
    const event = buildReflectionEvent({
      source: "compaction",
      nowMs: Date.parse("2026-04-23T09:00:00.000Z"),
      sessionKey: "agent:main:main",
      promptSummary: "Pre-compaction memory flush",
      outcomeSummary: "Memory flush completed and rotated the session.",
      succeeded: true,
      whatWorked: ["Memory flush completed and rotated the session."],
      durableFacts: ["Memory flush rotated the session after persisting context."],
      confidence: 0.84,
      provenance: {
        artifactPaths: ["memory/2026-04-23.md"],
      },
    });

    maybeTriggerEvolutionForEvent({
      cfg: {
        agents: {
          defaults: {
            workspace: workspaceDir,
          },
        },
      },
      sessionKey: "agent:main:main",
      workspaceDir,
      event,
    });

    const metricsPath = path.join(workspaceDir, "memory", ".evolution", "metrics.json");
    await waitForPath(metricsPath);

    expect(await fs.readFile(metricsPath, "utf-8")).toContain('"compaction": 1');
  });
});
