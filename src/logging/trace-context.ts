import crypto from "node:crypto";

export type TraceContext = {
  traceId: string;
  requestId?: string;
  runId?: string;
  sessionId?: string;
  agentId?: string;
  pluginId?: string;
  channel?: string;
  nodeId?: string;
  method?: string;
};

function createTraceId(): string {
  return `tr_${crypto.randomUUID()}`;
}

export function createTraceContext(seed?: Partial<TraceContext>): TraceContext {
  return {
    traceId: seed?.traceId?.trim() ? seed.traceId : createTraceId(),
    requestId: seed?.requestId,
    runId: seed?.runId,
    sessionId: seed?.sessionId,
    agentId: seed?.agentId,
    pluginId: seed?.pluginId,
    channel: seed?.channel,
    nodeId: seed?.nodeId,
    method: seed?.method,
  };
}

export function deriveTraceContext(
  parent: TraceContext,
  patch?: Partial<TraceContext>,
): TraceContext {
  return {
    ...parent,
    ...patch,
    traceId: parent.traceId,
  };
}

export function withTraceDefaults(
  ctx: TraceContext | undefined,
  patch?: Partial<TraceContext>,
): TraceContext {
  if (ctx) {
    return deriveTraceContext(ctx, patch);
  }
  return createTraceContext(patch);
}
