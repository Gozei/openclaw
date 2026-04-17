import { beforeEach, describe, expect, test } from "vitest";
import {
  emitAgentApprovalEvent,
  emitAgentEvent,
  emitAgentItemEvent,
  registerAgentRunContext,
  resetAgentEventsForTest,
} from "./agent-events.js";
import {
  getAgentRuntimeSnapshot,
  onAgentRuntimeStateChange,
  resetAgentRuntimeStateForTest,
} from "./agent-runtime-state.js";

describe("agent runtime state projection", () => {
  beforeEach(() => {
    resetAgentEventsForTest();
    resetAgentRuntimeStateForTest();
  });

  test("projects lifecycle start and completion into runtime snapshots", () => {
    registerAgentRunContext("run-main", { sessionKey: "agent:main" });

    emitAgentEvent({
      runId: "run-main",
      stream: "lifecycle",
      data: { phase: "start", startedAt: 100 },
    });

    expect(getAgentRuntimeSnapshot("run-main")).toMatchObject({
      runId: "run-main",
      sessionKey: "agent:main",
      status: "running",
      lifecyclePhase: "start",
      startedAt: expect.any(Number),
    });

    emitAgentEvent({
      runId: "run-main",
      stream: "lifecycle",
      data: { phase: "end", endedAt: 200 },
    });

    expect(getAgentRuntimeSnapshot("run-main")).toMatchObject({
      runId: "run-main",
      status: "completed",
      lifecyclePhase: "end",
      endedAt: 200,
    });
  });

  test("marks pending approvals as blocked and restores running on approval", () => {
    emitAgentEvent({
      runId: "run-approval",
      stream: "lifecycle",
      data: { phase: "start" },
    });

    emitAgentApprovalEvent({
      runId: "run-approval",
      data: {
        phase: "requested",
        kind: "exec",
        status: "pending",
        title: "Run test command",
        approvalId: "appr-1",
      },
    });

    expect(getAgentRuntimeSnapshot("run-approval")).toMatchObject({
      status: "blocked",
      blocker: {
        kind: "approval",
        title: "Run test command",
        approvalId: "appr-1",
      },
    });

    emitAgentApprovalEvent({
      runId: "run-approval",
      data: {
        phase: "resolved",
        kind: "exec",
        status: "approved",
        title: "Run test command",
        approvalId: "appr-1",
      },
    });

    expect(getAgentRuntimeSnapshot("run-approval")).toMatchObject({
      status: "running",
      blocker: undefined,
    });
  });

  test("projects blocked item status and clears it when the item ends", () => {
    emitAgentEvent({
      runId: "run-item",
      stream: "lifecycle",
      data: { phase: "start" },
    });

    emitAgentItemEvent({
      runId: "run-item",
      data: {
        itemId: "tool-1",
        phase: "update",
        kind: "tool",
        title: "Waiting for browser session",
        status: "blocked",
        meta: "browser auth required",
      },
    });

    expect(getAgentRuntimeSnapshot("run-item")).toMatchObject({
      status: "blocked",
      blocker: {
        kind: "item",
        itemId: "tool-1",
        title: "Waiting for browser session",
        reason: "browser auth required",
      },
    });

    emitAgentItemEvent({
      runId: "run-item",
      data: {
        itemId: "tool-1",
        phase: "end",
        kind: "tool",
        title: "Waiting for browser session",
        status: "completed",
      },
    });

    expect(getAgentRuntimeSnapshot("run-item")).toMatchObject({
      status: "running",
      blocker: undefined,
    });
  });

  test("emits runtime change notifications with previous and current snapshots", () => {
    const seen: Array<{ status: string; previous?: string }> = [];
    const stop = onAgentRuntimeStateChange((event) => {
      seen.push({
        status: event.current.status,
        previous: event.previous?.status,
      });
    });

    emitAgentEvent({
      runId: "run-events",
      stream: "lifecycle",
      data: { phase: "start" },
    });
    emitAgentEvent({
      runId: "run-events",
      stream: "lifecycle",
      data: { phase: "error", error: "boom" },
    });

    stop();

    expect(seen).toEqual([
      { status: "running", previous: undefined },
      { status: "failed", previous: "running" },
    ]);
  });
});
