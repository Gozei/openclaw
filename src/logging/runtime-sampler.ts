import { createPerfEvent, logPerfEvent } from "./perf.js";

export type RuntimeSamplerOptions = {
  intervalMs?: number;
  getActiveAgentRuns?: () => number;
  getQueueSize?: () => number;
};

export type RuntimeSamplerHandle = {
  stop: () => void;
};

const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_MS = 1_000;
const SAMPLER_TRACE_ID = "tr_runtime_sampler";

export function startRuntimeSampler(options: RuntimeSamplerOptions = {}): RuntimeSamplerHandle {
  const intervalMs = normalizeIntervalMs(options.intervalMs);
  let stopped = false;
  let expectedAt = Date.now() + intervalMs;
  let previousCpuUsage = process.cpuUsage();

  const timer = setInterval(() => {
    if (stopped) {
      return;
    }
    const now = Date.now();
    const eventLoopLagMs = Math.max(0, now - expectedAt);
    expectedAt = now + intervalMs;

    const memory = process.memoryUsage();
    const currentCpuUsage = process.cpuUsage();
    const cpuDelta = {
      user: currentCpuUsage.user - previousCpuUsage.user,
      system: currentCpuUsage.system - previousCpuUsage.system,
    };
    previousCpuUsage = currentCpuUsage;

    logPerfEvent(
      createPerfEvent({
        kind: "perf-sample",
        name: "runtime.resources",
        traceId: SAMPLER_TRACE_ID,
        startedAt: new Date(now).toISOString(),
        durationMs: 0,
        details: {
          timestampMs: now,
          rss: memory.rss,
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
          external: memory.external,
          ...(typeof memory.arrayBuffers === "number" ? { arrayBuffers: memory.arrayBuffers } : {}),
          cpuUserMicros: cpuDelta.user,
          cpuSystemMicros: cpuDelta.system,
          eventLoopLagMs,
          ...(options.getActiveAgentRuns ? { activeAgentRuns: options.getActiveAgentRuns() } : {}),
          ...(options.getQueueSize ? { queueSize: options.getQueueSize() } : {}),
        },
      }),
    );
  }, intervalMs);

  timer.unref?.();

  return {
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(timer);
    },
  };
}

function normalizeIntervalMs(intervalMs: number | undefined): number {
  if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs)) {
    return DEFAULT_INTERVAL_MS;
  }
  return Math.max(MIN_INTERVAL_MS, Math.floor(intervalMs));
}
