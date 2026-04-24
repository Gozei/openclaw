import type { WorkflowCandidate } from "./types.js";

type WorkflowCompileParams = {
  task: string;
  taskLabel?: string;
  summary: string;
  error?: string;
  runtime: string;
};

function normalizeLine(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function splitSentences(value: string): string[] {
  return value
    .split(/[.\n]+/g)
    .map((line) => normalizeLine(line))
    .filter(Boolean);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeLine(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function containsKeyword(value: string, pattern: RegExp): boolean {
  return pattern.test(value.toLowerCase());
}

function inferScenario(params: WorkflowCompileParams): "ci_triage" | "code_fix" | "generic" {
  const corpus = `${params.taskLabel ?? ""} ${params.task} ${params.summary} ${params.error ?? ""}`;
  if (
    containsKeyword(
      corpus,
      /\b(ci|check|checks|workflow|workflows|flake|flaky|failing lane|pr|pull request|test suite|shard)\b/,
    )
  ) {
    return "ci_triage";
  }
  if (
    containsKeyword(
      corpus,
      /\b(fix|patch|regression|bug|failing test|typecheck|compile|lint|refactor|repair)\b/,
    )
  ) {
    return "code_fix";
  }
  return "generic";
}

function inferTrigger(
  params: WorkflowCompileParams,
  scenario: ReturnType<typeof inferScenario>,
): string {
  if (scenario === "ci_triage") {
    return "CI fails or verification regresses";
  }
  if (scenario === "code_fix") {
    return "Repeated code fix or regression repair request";
  }
  return `Repeated ${params.runtime} task`;
}

function inferTools(
  params: WorkflowCompileParams,
  scenario: ReturnType<typeof inferScenario>,
): string[] {
  const tools = [params.runtime];
  if (scenario === "ci_triage") {
    tools.push("exec", "github");
  } else if (scenario === "code_fix") {
    tools.push("read", "write", "exec");
  }
  return dedupe(tools);
}

function inferSteps(
  params: WorkflowCompileParams,
  scenario: ReturnType<typeof inferScenario>,
): string[] {
  const taskStep = normalizeLine(params.task);
  const summarySteps = splitSentences(params.summary);
  const scenarioStep =
    scenario === "ci_triage"
      ? "Inspect the failing lane, shard, or check output before rerunning broad suites"
      : scenario === "code_fix"
        ? "Reproduce the failure at the smallest boundary before patching"
        : "";
  return dedupe([taskStep, scenarioStep, ...summarySteps]).slice(0, 6);
}

function inferSuccessCriteria(
  params: WorkflowCompileParams,
  scenario: ReturnType<typeof inferScenario>,
): string[] {
  const base =
    scenario === "ci_triage"
      ? ["The failing lane is isolated", "Only targeted verification is rerun"]
      : scenario === "code_fix"
        ? ["The regression is reproduced locally", "The smallest valid fix is verified"]
        : ["The task reaches a successful terminal state"];
  return dedupe([...base, normalizeLine(params.summary)]).slice(0, 4);
}

function inferFallbackNotes(params: WorkflowCompileParams): string[] {
  return dedupe(splitSentences(params.error ?? "")).slice(0, 3);
}

export function buildWorkflowCandidateFromExecution(
  params: WorkflowCompileParams,
): WorkflowCandidate {
  const scenario = inferScenario(params);
  return {
    title: normalizeLine(params.taskLabel ?? params.task),
    trigger: inferTrigger(params, scenario),
    steps: inferSteps(params, scenario),
    tools: inferTools(params, scenario),
    successCriteria: inferSuccessCriteria(params, scenario),
    fallbackNotes: inferFallbackNotes(params),
  };
}
