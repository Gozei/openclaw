import { createSubsystemLogger } from "./subsystem.js";
import type { TraceContext } from "./trace-context.js";

const perfLog = createSubsystemLogger("perf");

export type PerfOutcome = "ok" | "error" | "timeout" | "cancelled" | "blocked";

export type PerfEventKind = "perf" | "perf-sample";

export type PerfEvent = {
  kind: PerfEventKind;
  name: string;
  traceId: string;
  requestId?: string;
  runId?: string;
  sessionId?: string;
  agentId?: string;
  pluginId?: string;
  channel?: string;
  nodeId?: string;
  method?: string;
  phase?: string;
  startedAt?: string;
  durationMs?: number;
  outcome?: PerfOutcome;
  slow?: boolean;
  coldStart?: boolean;
  errorCode?: string;
  details?: Record<string, unknown>;
};

export type PerfThresholds = {
  gatewayMethodMs: number;
  agentPhaseMs: number;
  toolCallMs: number;
  pluginLoadMs: number;
  firstTokenMs: number;
};

export type PerfSpan = {
  name: string;
  trace: TraceContext;
  phase?: string;
  coldStart?: boolean;
  startedAtMs: number;
  startedAtIso: string;
  details?: Record<string, unknown>;
};

const DEFAULT_PERF_THRESHOLDS: PerfThresholds = {
  gatewayMethodMs: 100,
  agentPhaseMs: 150,
  toolCallMs: 300,
  pluginLoadMs: 120,
  firstTokenMs: 1500,
};

function mergeDetails(
  base?: Record<string, unknown>,
  extra?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!base && !extra) {
    return undefined;
  }
  return {
    ...base,
    ...extra,
  };
}

function sanitizeDurationMs(startedAtMs: number): number {
  const durationMs = Date.now() - startedAtMs;
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
}

export function getDefaultPerfThresholds(): PerfThresholds {
  return { ...DEFAULT_PERF_THRESHOLDS };
}

export function startPerfSpan(params: {
  name: string;
  trace: TraceContext;
  phase?: string;
  coldStart?: boolean;
  details?: Record<string, unknown>;
}): PerfSpan {
  return {
    name: params.name,
    trace: params.trace,
    phase: params.phase,
    coldStart: params.coldStart,
    startedAtMs: Date.now(),
    startedAtIso: new Date().toISOString(),
    details: params.details,
  };
}

export function isSlowPerfEvent(event: PerfEvent, thresholdMs: number | undefined): boolean {
  return typeof thresholdMs === "number" &&
    Number.isFinite(thresholdMs) &&
    thresholdMs >= 0 &&
    typeof event.durationMs === "number"
    ? event.durationMs >= thresholdMs
    : false;
}

export function createPerfEvent(params: PerfEvent): PerfEvent {
  return {
    ...params,
    details: params.details ? { ...params.details } : undefined,
  };
}

export function finishPerfSpan(
  span: PerfSpan,
  params?: {
    outcome?: PerfOutcome;
    errorCode?: string;
    details?: Record<string, unknown>;
    slowThresholdMs?: number;
  },
): PerfEvent {
  const event = createPerfEvent({
    kind: "perf",
    name: span.name,
    traceId: span.trace.traceId,
    requestId: span.trace.requestId,
    runId: span.trace.runId,
    sessionId: span.trace.sessionId,
    agentId: span.trace.agentId,
    pluginId: span.trace.pluginId,
    channel: span.trace.channel,
    nodeId: span.trace.nodeId,
    method: span.trace.method,
    phase: span.phase,
    startedAt: span.startedAtIso,
    durationMs: sanitizeDurationMs(span.startedAtMs),
    outcome: params?.outcome ?? "ok",
    coldStart: span.coldStart,
    errorCode: params?.errorCode,
    details: mergeDetails(span.details, params?.details),
  });
  event.slow = isSlowPerfEvent(event, params?.slowThresholdMs);
  return event;
}

export function logPerfEvent(event: PerfEvent): void {
  try {
    perfLog.debug(event.name, {
      ...event,
      kind: event.kind,
    });
  } catch {
    // Never let perf logging affect runtime behavior.
  }
}
