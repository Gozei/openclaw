import { describe, expect, it } from "vitest";
import { createTraceContext, deriveTraceContext, withTraceDefaults } from "./trace-context.js";

describe("trace context helpers", () => {
  it("creates a trace id when none is provided", () => {
    const trace = createTraceContext();

    expect(trace.traceId).toMatch(/^tr_/);
  });

  it("preserves an explicit trace id", () => {
    const trace = createTraceContext({ traceId: "tr_existing", requestId: "req-1" });

    expect(trace).toEqual({
      traceId: "tr_existing",
      requestId: "req-1",
      runId: undefined,
      sessionId: undefined,
      agentId: undefined,
      pluginId: undefined,
      channel: undefined,
      nodeId: undefined,
      method: undefined,
    });
  });

  it("inherits the parent trace id while applying patch values", () => {
    const trace = deriveTraceContext(
      {
        traceId: "tr_parent",
        requestId: "req-1",
        runId: "run-1",
      },
      {
        runId: "run-2",
        sessionId: "session-1",
        traceId: "tr_ignored",
      },
    );

    expect(trace).toEqual({
      traceId: "tr_parent",
      requestId: "req-1",
      runId: "run-2",
      sessionId: "session-1",
    });
  });

  it("creates a new trace when defaults are missing", () => {
    const trace = withTraceDefaults(undefined, { method: "agent" });

    expect(trace.traceId).toMatch(/^tr_/);
    expect(trace.method).toBe("agent");
  });

  it("reuses an existing trace when defaults are present", () => {
    const trace = withTraceDefaults(
      {
        traceId: "tr_parent",
        requestId: "req-1",
      },
      { method: "chat" },
    );

    expect(trace).toEqual({
      traceId: "tr_parent",
      requestId: "req-1",
      method: "chat",
    });
  });
});
