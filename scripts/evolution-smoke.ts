#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { resetConfigRuntimeState, setRuntimeConfigSnapshot } from "../src/config/io.js";
import {
  maybeTriggerEvolutionForReplyRun,
  maybeTriggerEvolutionForTasks,
} from "../src/evolution/auto.js";

type SmokeOptions = {
  workspaceDir: string;
  cleanup: boolean;
};

type SmokeSummary = {
  workspaceDir: string;
  dateStamp: string;
  checks: {
    dailyHasMainReply: boolean;
    dailyHasFailureLesson: boolean;
    memoryHasDurableFact: boolean;
    metricsCycles: number;
    metricsSuccesses: number;
    metricsFailures: number;
    repeatedFailures: number;
    ruleProposalCount: number;
    workflowCount: number;
    reportExists: boolean;
  };
  files: {
    dailyPath: string;
    memoryPath: string;
    userPath: string;
    failuresPath: string;
    workflowsPath: string;
    metricsPath: string;
    reportPath: string;
    rulesDir: string;
    skillsDir: string;
    summaryPath: string;
  };
};

function parseArgs(argv: string[]): SmokeOptions {
  const cwd = process.cwd();
  const defaultWorkspaceDir = path.join(
    cwd,
    ".artifacts",
    "evolution-smoke",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  let workspaceDir = defaultWorkspaceDir;
  let cleanup = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      continue;
    }
    if (token === "--workspace") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --workspace");
      }
      workspaceDir = path.resolve(cwd, value);
      index += 1;
      continue;
    }
    if (token === "--cleanup") {
      cleanup = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return { workspaceDir, cleanup };
}

async function waitForPath(targetPath: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.access(targetPath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out waiting for ${targetPath}`);
}

async function runSmoke(options: SmokeOptions): Promise<SmokeSummary> {
  await fs.mkdir(options.workspaceDir, { recursive: true });

  const cfg = {
    agents: {
      defaults: {
        workspace: options.workspaceDir,
      },
    },
  };

  setRuntimeConfigSnapshot(cfg);

  const nowMs = Date.now();
  const dateStamp = new Date(nowMs).toISOString().slice(0, 10);
  const dailyPath = path.join(options.workspaceDir, "memory", `${dateStamp}.md`);
  const memoryPath = path.join(options.workspaceDir, "MEMORY.md");
  const userPath = path.join(options.workspaceDir, "USER.md");
  const failuresPath = path.join(options.workspaceDir, "memory", ".evolution", "failures.json");
  const workflowsPath = path.join(options.workspaceDir, "memory", ".evolution", "workflows.json");
  const metricsPath = path.join(options.workspaceDir, "memory", ".evolution", "metrics.json");
  const reportPath = path.join(
    options.workspaceDir,
    "memory",
    ".evolution",
    "reports",
    `${dateStamp}.md`,
  );
  const rulesDir = path.join(options.workspaceDir, "memory", ".evolution", "proposals", "rules");
  const skillsDir = path.join(options.workspaceDir, "memory", ".evolution", "proposals", "skills");
  const summaryPath = path.join(options.workspaceDir, "memory", ".evolution", "summary.json");

  maybeTriggerEvolutionForReplyRun({
    cfg,
    sessionKey: "agent:main:main",
    agentId: "main",
    workspaceDir: options.workspaceDir,
    promptSummary: "Summarize how to fix CI fast",
    reply: {
      text: "Start with the failing lane, isolate the regression, then rerun only the targeted checks.",
    },
  });

  const baseTask = {
    runtime: "subagent" as const,
    taskKind: "ci",
    requesterSessionKey: "agent:main:main",
    childSessionKey: "agent:main:subagent:smoke",
    ownerKey: "agent:main:main",
    scopeKind: "session" as const,
    agentId: "main",
    label: "CI triage",
    task: "Inspect the failing CI lane",
    deliveryStatus: "pending" as const,
    notifyPolicy: "done_only" as const,
    createdAt: nowMs,
    endedAt: nowMs + 1_000,
  };

  maybeTriggerEvolutionForTasks([
    {
      ...baseTask,
      taskId: "task-1",
      runId: "run-1",
      status: "failed" as const,
      terminalSummary: "Retried the full suite before checking the failing lane.",
      error: "Missing targeted triage",
    },
  ]);
  maybeTriggerEvolutionForTasks([
    {
      ...baseTask,
      taskId: "task-2",
      runId: "run-2",
      status: "failed" as const,
      terminalSummary: "Retried the full suite before checking the failing lane.",
      error: "Missing targeted triage",
    },
  ]);
  maybeTriggerEvolutionForTasks([
    {
      ...baseTask,
      taskId: "task-3",
      runId: "run-3",
      status: "succeeded" as const,
      terminalSummary: "Grouped failing checks and captured a reusable recovery path.",
      terminalOutcome: "succeeded" as const,
    },
  ]);

  await waitForPath(dailyPath);
  await waitForPath(memoryPath);
  await waitForPath(metricsPath);
  await waitForPath(reportPath);
  await waitForPath(failuresPath);
  await waitForPath(workflowsPath);
  await waitForPath(rulesDir);

  const [dailyText, memoryText, metricsRaw, workflowsRaw, reportText, ruleFiles] =
    await Promise.all([
      fs.readFile(dailyPath, "utf-8"),
      fs.readFile(memoryPath, "utf-8"),
      fs.readFile(metricsPath, "utf-8"),
      fs.readFile(workflowsPath, "utf-8"),
      fs.readFile(reportPath, "utf-8"),
      fs.readdir(rulesDir),
    ]);

  const metrics = JSON.parse(metricsRaw) as {
    days?: Array<{
      cycles?: number;
      successes?: number;
      failures?: number;
      repeatedFailures?: number;
    }>;
  };
  const workflows = JSON.parse(workflowsRaw) as Array<{ count?: number }>;
  const latestDay = metrics.days?.at(-1) ?? {};

  const summary: SmokeSummary = {
    workspaceDir: options.workspaceDir,
    dateStamp,
    checks: {
      dailyHasMainReply: dailyText.includes("Start with the failing lane"),
      dailyHasFailureLesson: dailyText.includes(
        "Retried the full suite before checking the failing lane.",
      ),
      memoryHasDurableFact: memoryText.includes(
        "Grouped failing checks and captured a reusable recovery path.",
      ),
      metricsCycles: latestDay.cycles ?? 0,
      metricsSuccesses: latestDay.successes ?? 0,
      metricsFailures: latestDay.failures ?? 0,
      repeatedFailures: latestDay.repeatedFailures ?? 0,
      ruleProposalCount: ruleFiles.length,
      workflowCount: workflows.reduce((sum, entry) => sum + (entry.count ?? 0), 0),
      reportExists: reportText.includes(`# Evolution Report ${dateStamp}`),
    },
    files: {
      dailyPath,
      memoryPath,
      userPath,
      failuresPath,
      workflowsPath,
      metricsPath,
      reportPath,
      rulesDir,
      skillsDir,
      summaryPath,
    },
  };

  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf-8");
  return summary;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(`[evolution-smoke] workspace=${options.workspaceDir}`);
  try {
    const summary = await runSmoke(options);
    const failures = Object.entries(summary.checks).filter(([, value]) => {
      return typeof value === "boolean" ? !value : false;
    });

    console.log("[evolution-smoke] summary");
    console.log(JSON.stringify(summary, null, 2));
    console.log("[evolution-smoke] manual checklist");
    console.log(
      `- Open ${summary.files.dailyPath} and confirm both main-reply and failure notes exist.`,
    );
    console.log(`- Open ${summary.files.reportPath} and confirm the day summary reads sensibly.`);
    console.log(`- Open ${summary.files.rulesDir} and inspect the promoted rule proposal.`);
    console.log(`- Open ${summary.files.summaryPath} for the machine-readable smoke summary.`);
    if (options.cleanup) {
      console.log(
        "[evolution-smoke] note: --cleanup removes the workspace after this run, so omit it for manual inspection.",
      );
    }

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    resetConfigRuntimeState();
    if (options.cleanup) {
      await fs.rm(options.workspaceDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error("[evolution-smoke] failed", error);
  resetConfigRuntimeState();
  process.exit(1);
});
