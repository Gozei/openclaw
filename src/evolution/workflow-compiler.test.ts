import { describe, expect, it } from "vitest";
import { buildWorkflowCandidateFromExecution } from "./workflow-compiler.js";

describe("buildWorkflowCandidateFromExecution", () => {
  it("compiles ci triage runs into a reusable workflow", () => {
    const workflow = buildWorkflowCandidateFromExecution({
      task: "Inspect the failing CI lane on this PR",
      taskLabel: "CI triage",
      summary: "Grouped failing checks by shard. Re-ran only the websocket smoke lane.",
      error: "Escalate if logs are missing.",
      runtime: "subagent",
    });

    expect(workflow.trigger).toBe("CI fails or verification regresses");
    expect(workflow.tools).toEqual(expect.arrayContaining(["subagent", "exec", "github"]));
    expect(workflow.steps).toEqual(
      expect.arrayContaining([
        "Inspect the failing lane, shard, or check output before rerunning broad suites",
        "Grouped failing checks by shard",
      ]),
    );
  });

  it("compiles repeated code-fix runs into a reusable workflow", () => {
    const workflow = buildWorkflowCandidateFromExecution({
      task: "Fix the regression in the config loader",
      taskLabel: "Config regression fix",
      summary:
        "Reproduced the failure with a focused unit test. Patched the narrow parsing branch.",
      error: "",
      runtime: "task",
    });

    expect(workflow.trigger).toBe("Repeated code fix or regression repair request");
    expect(workflow.tools).toEqual(expect.arrayContaining(["task", "read", "write", "exec"]));
    expect(workflow.steps).toEqual(
      expect.arrayContaining([
        "Reproduce the failure at the smallest boundary before patching",
        "Patched the narrow parsing branch",
      ]),
    );
  });
});
