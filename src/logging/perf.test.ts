import { afterEach, describe, expect, it } from "vitest";
import { registerLogTransport, resetLogger, setLoggerOverride } from "./logger.js";
import {
  createPerfEvent,
  finishPerfSpan,
  getDefaultPerfThresholds,
  isSlowPerfEvent,
  logPerfEvent,
  startPerfSpan,
} from "./perf.js";
import { createTraceContext } from "./trace-context.js";

afterEach(() => {
  setLoggerOverride(null);
  resetLogger();
});

describe("perf helpers", () => {
  it("returns a fresh copy of the default thresholds", () => {
    const first = getDefaultPerfThresholds();
    const second = getDefaultPerfThresholds();

    expect(first).toEqual({
      gatewayMethodMs: 100,
      agentPhaseMs: 150,
      toolCallMs: 300,
      pluginLoadMs: 120,
      firstTokenMs: 1500,
    });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("creates span events with merged details and slow thresholds", () => {
    const span = startPerfSpan({
      name: "gateway.request.total",
      trace: createTraceContext({ requestId: "req-1", method: "agent" }),
      details: { payloadBytes: 12 },
      phase: "dispatch",
      coldStart: true,
    });

    const event = finishPerfSpan(span, {
      outcome: "ok",
      details: { responseBytes: 24 },
      slowThresholdMs: 0,
    });

    expect(event.traceId).toMatch(/^tr_/);
    expect(event.requestId).toBe("req-1");
    expect(event.method).toBe("agent");
    expect(event.phase).toBe("dispatch");
    expect(event.outcome).toBe("ok");
    expect(event.coldStart).toBe(true);
    expect(event.slow).toBe(true);
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(event.details).toEqual({
      payloadBytes: 12,
      responseBytes: 24,
    });
  });

  it("creates defensive copies of perf events", () => {
    const raw = createPerfEvent({
      kind: "perf",
      name: "agent.run.total",
      traceId: "tr_1",
      details: { a: 1 },
    });

    expect(raw).toEqual({
      kind: "perf",
      name: "agent.run.total",
      traceId: "tr_1",
      details: { a: 1 },
    });
    expect(raw.details).not.toBeUndefined();
    expect(raw.details).not.toBe({
      a: 1,
    } as unknown as Record<string, unknown>);
  });

  it("detects slow perf events only when thresholds are provided", () => {
    expect(
      isSlowPerfEvent(
        {
          kind: "perf",
          name: "tool.call.total",
          traceId: "tr_1",
          durationMs: 25,
        },
        20,
      ),
    ).toBe(true);

    expect(
      isSlowPerfEvent(
        {
          kind: "perf",
          name: "tool.call.total",
          traceId: "tr_1",
          durationMs: 25,
        },
        undefined,
      ),
    ).toBe(false);
  });

  it("logs perf events through the structured logger transport", () => {
    setLoggerOverride({ level: "debug", consoleLevel: "silent" });
    const records: Record<string, unknown>[] = [];
    const unregister = registerLogTransport((record) => {
      records.push(record);
    });

    try {
      logPerfEvent({
        kind: "perf",
        name: "gateway.request.total",
        traceId: "tr_perf",
        requestId: "req-1",
        method: "agent",
        durationMs: 42,
        outcome: "ok",
      });
    } finally {
      unregister();
    }

    expect(records).toHaveLength(1);
    expect(records[0]?.[1]).toMatchObject({
      kind: "perf",
      name: "gateway.request.total",
      traceId: "tr_perf",
      requestId: "req-1",
      method: "agent",
      durationMs: 42,
      outcome: "ok",
    });
  });

  it("never throws while logging perf events", () => {
    expect(() =>
      logPerfEvent({
        kind: "perf-sample",
        name: "runtime.resources",
        traceId: "tr_sampler",
      }),
    ).not.toThrow();
  });
});
