import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { notifyListeners, registerListener } from "../shared/listeners.js";
import type {
  AgentApprovalEventData,
  AgentEventPayload,
  AgentItemEventData,
} from "./agent-event-types.js";

export type AgentRuntimeStatus =
  | "idle"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentRuntimeBlocker =
  | {
      kind: "approval";
      title: string;
      approvalId?: string;
      approvalSlug?: string;
      reason?: string;
    }
  | {
      kind: "item";
      title: string;
      itemId: string;
      itemKind?: string;
      reason?: string;
    };

export type AgentRuntimeSnapshot = {
  runId: string;
  sessionKey?: string;
  status: AgentRuntimeStatus;
  startedAt?: number;
  updatedAt: number;
  endedAt?: number;
  lastError?: string;
  blocker?: AgentRuntimeBlocker;
  lifecyclePhase?: string;
  lastNonTerminalStatus?: Exclude<AgentRuntimeStatus, "completed" | "failed" | "cancelled">;
};

type AgentRuntimeChangeEvent = {
  current: AgentRuntimeSnapshot;
  previous?: AgentRuntimeSnapshot;
  sourceEvent: AgentEventPayload;
};

type AgentRuntimeState = {
  snapshots: Map<string, AgentRuntimeSnapshot>;
  listeners: Set<(event: AgentRuntimeChangeEvent) => void>;
};

const AGENT_RUNTIME_STATE_KEY = Symbol.for("openclaw.agentRuntimeState");

function getAgentRuntimeState(): AgentRuntimeState {
  return resolveGlobalSingleton<AgentRuntimeState>(AGENT_RUNTIME_STATE_KEY, () => ({
    snapshots: new Map<string, AgentRuntimeSnapshot>(),
    listeners: new Set<(event: AgentRuntimeChangeEvent) => void>(),
  }));
}

function cloneSnapshot(snapshot: AgentRuntimeSnapshot): AgentRuntimeSnapshot {
  return {
    ...snapshot,
    blocker: snapshot.blocker ? { ...snapshot.blocker } : undefined,
  };
}

function normalizeErrorValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getLifecyclePhase(event: AgentEventPayload): string | undefined {
  return typeof event.data?.phase === "string" && event.data.phase.trim()
    ? event.data.phase.trim()
    : undefined;
}

function getApprovalData(event: AgentEventPayload): AgentApprovalEventData | null {
  if (event.stream !== "approval") {
    return null;
  }
  return event.data as unknown as AgentApprovalEventData;
}

function getItemData(event: AgentEventPayload): AgentItemEventData | null {
  if (event.stream !== "item") {
    return null;
  }
  return event.data as unknown as AgentItemEventData;
}

function resolveRunningFallbackStatus(
  snapshot: AgentRuntimeSnapshot,
): Exclude<AgentRuntimeStatus, "completed" | "failed" | "cancelled"> {
  const candidate = snapshot.lastNonTerminalStatus;
  if (candidate === "idle" || candidate === "running" || candidate === "blocked") {
    return candidate === "blocked" ? "running" : candidate;
  }
  return snapshot.startedAt ? "running" : "idle";
}

function applyLifecycleProjection(snapshot: AgentRuntimeSnapshot, event: AgentEventPayload): void {
  const phase = getLifecyclePhase(event);
  if (!phase) {
    return;
  }
  snapshot.lifecyclePhase = phase;
  if (phase === "start") {
    snapshot.status = "running";
    snapshot.startedAt ??= event.ts;
    snapshot.endedAt = undefined;
    snapshot.lastError = undefined;
    snapshot.blocker = undefined;
    snapshot.lastNonTerminalStatus = "running";
    return;
  }
  if (phase === "end") {
    snapshot.status = "completed";
    snapshot.endedAt = typeof event.data?.endedAt === "number" ? event.data.endedAt : event.ts;
    snapshot.blocker = undefined;
    return;
  }
  if (phase === "error") {
    snapshot.status = "failed";
    snapshot.endedAt = typeof event.data?.endedAt === "number" ? event.data.endedAt : event.ts;
    snapshot.lastError = normalizeErrorValue(event.data?.error) ?? "Agent run failed.";
    snapshot.blocker = undefined;
  }
}

function applyApprovalProjection(snapshot: AgentRuntimeSnapshot, event: AgentEventPayload): void {
  const data = getApprovalData(event);
  if (!data) {
    return;
  }
  if (data.phase === "requested" && (data.status === "pending" || data.status === "unavailable")) {
    if (
      snapshot.status !== "completed" &&
      snapshot.status !== "failed" &&
      snapshot.status !== "cancelled"
    ) {
      snapshot.lastNonTerminalStatus =
        snapshot.status === "idle" ? "running" : resolveRunningFallbackStatus(snapshot);
      snapshot.status = "blocked";
      snapshot.blocker = {
        kind: "approval",
        title: data.title,
        approvalId: data.approvalId,
        approvalSlug: data.approvalSlug,
        reason: data.reason ?? data.message,
      };
    }
    return;
  }
  if (data.phase === "resolved") {
    if (data.status === "approved") {
      if (
        snapshot.status !== "completed" &&
        snapshot.status !== "failed" &&
        snapshot.status !== "cancelled"
      ) {
        snapshot.status = resolveRunningFallbackStatus(snapshot);
        snapshot.blocker = undefined;
      }
      return;
    }
    if (data.status === "denied" || data.status === "failed") {
      snapshot.status = "failed";
      snapshot.endedAt = event.ts;
      snapshot.lastError = data.message ?? data.reason ?? "Approval request failed.";
      snapshot.blocker = undefined;
    }
  }
}

function applyItemProjection(snapshot: AgentRuntimeSnapshot, event: AgentEventPayload): void {
  const data = getItemData(event);
  if (!data) {
    return;
  }
  if (data.status === "blocked") {
    if (
      snapshot.status !== "completed" &&
      snapshot.status !== "failed" &&
      snapshot.status !== "cancelled"
    ) {
      snapshot.lastNonTerminalStatus =
        snapshot.status === "idle" ? "running" : resolveRunningFallbackStatus(snapshot);
      snapshot.status = "blocked";
      snapshot.blocker = {
        kind: "item",
        title: data.title,
        itemId: data.itemId,
        itemKind: data.kind,
        reason: data.error ?? data.meta,
      };
    }
    return;
  }
  if (data.phase === "end" && data.status === "failed") {
    snapshot.status = "failed";
    snapshot.endedAt = data.endedAt ?? event.ts;
    snapshot.lastError = data.error ?? "Agent item failed.";
    snapshot.blocker = undefined;
    return;
  }
  if (
    snapshot.blocker?.kind === "item" &&
    snapshot.blocker.itemId === data.itemId &&
    (data.phase === "end" || data.status === "running" || data.status === "completed")
  ) {
    if (
      snapshot.status !== "completed" &&
      snapshot.status !== "failed" &&
      snapshot.status !== "cancelled"
    ) {
      snapshot.status = resolveRunningFallbackStatus(snapshot);
      snapshot.blocker = undefined;
    }
  }
}

export function projectAgentRuntimeEvent(event: AgentEventPayload): AgentRuntimeSnapshot {
  const state = getAgentRuntimeState();
  const previous = state.snapshots.get(event.runId);
  const next: AgentRuntimeSnapshot = previous
    ? cloneSnapshot(previous)
    : {
        runId: event.runId,
        status: "idle",
        updatedAt: event.ts,
      };
  if (event.sessionKey) {
    next.sessionKey = event.sessionKey;
  }
  next.updatedAt = event.ts;

  if (event.stream === "lifecycle") {
    applyLifecycleProjection(next, event);
  } else if (event.stream === "approval") {
    applyApprovalProjection(next, event);
  } else if (event.stream === "item") {
    applyItemProjection(next, event);
  } else if (event.stream === "error") {
    next.status = "failed";
    next.endedAt = event.ts;
    next.lastError = normalizeErrorValue(event.data?.error) ?? "Agent run failed.";
    next.blocker = undefined;
  }

  if (next.status === "running" || next.status === "blocked" || next.status === "idle") {
    next.lastNonTerminalStatus = next.status;
  }

  state.snapshots.set(event.runId, next);
  notifyListeners(state.listeners, {
    current: cloneSnapshot(next),
    previous: previous ? cloneSnapshot(previous) : undefined,
    sourceEvent: event,
  });
  return cloneSnapshot(next);
}

export function getAgentRuntimeSnapshot(runId: string): AgentRuntimeSnapshot | undefined {
  const snapshot = getAgentRuntimeState().snapshots.get(runId);
  return snapshot ? cloneSnapshot(snapshot) : undefined;
}

export function listAgentRuntimeSnapshots(): AgentRuntimeSnapshot[] {
  return Array.from(getAgentRuntimeState().snapshots.values(), cloneSnapshot);
}

export function clearAgentRuntimeSnapshot(runId: string): void {
  getAgentRuntimeState().snapshots.delete(runId);
}

export function onAgentRuntimeStateChange(listener: (event: AgentRuntimeChangeEvent) => void) {
  return registerListener(getAgentRuntimeState().listeners, listener);
}

export function resetAgentRuntimeStateForTest(): void {
  const state = getAgentRuntimeState();
  state.snapshots.clear();
  state.listeners.clear();
}
