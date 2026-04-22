import { afterEach, describe, expect, it, vi } from "vitest";
import { registerLogTransport, resetLogger, setLoggerOverride } from "./logger.js";
import { startRuntimeSampler } from "./runtime-sampler.js";

afterEach(() => {
  vi.useRealTimers();
  setLoggerOverride(null);
  resetLogger();
});

describe("runtime sampler", () => {
  it("logs runtime resource samples with queue and run counts", () => {
    vi.useFakeTimers();
    setLoggerOverride({ level: "debug", consoleLevel: "silent" });
    const records: Array<Record<string, unknown>> = [];
    const unregister = registerLogTransport((record) => {
      records.push(record);
    });

    try {
      const sampler = startRuntimeSampler({
        intervalMs: 1_000,
        getActiveAgentRuns: () => 3,
        getQueueSize: () => 7,
      });

      vi.advanceTimersByTime(1_000);
      sampler.stop();
      vi.advanceTimersByTime(5_000);
    } finally {
      unregister();
    }

    const runtimeRecord = records.find(
      (record) => (record[1] as { name?: string } | undefined)?.name === "runtime.resources",
    );

    expect(runtimeRecord?.[1]).toMatchObject({
      kind: "perf-sample",
      name: "runtime.resources",
      traceId: "tr_runtime_sampler",
      details: {
        activeAgentRuns: 3,
        queueSize: 7,
      },
    });
    const details = (runtimeRecord?.[1] as { details?: Record<string, unknown> } | undefined)
      ?.details;
    expect(typeof details?.rss).toBe("number");
    expect(typeof details?.heapUsed).toBe("number");
    expect(typeof details?.eventLoopLagMs).toBe("number");
  });
});
