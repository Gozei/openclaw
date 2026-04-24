import { resolveAgentWorkspaceDir } from "../agents/agent-scope-config.js";
import { stripHeartbeatToken } from "../auto-reply/heartbeat.js";
import type { ReplyPayload } from "../auto-reply/reply-payload.js";
import {
  isSilentReplyPayloadText,
  stripLeadingSilentToken,
  stripSilentToken,
} from "../auto-reply/tokens.js";
import { getRuntimeConfigSnapshot } from "../config/io.js";
import type { OpenClawConfig } from "../config/types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import type { TaskRecord } from "../tasks/task-registry.types.js";
import { resolveEvolutionConfig } from "./config.js";
import {
  loadEvolutionMetrics,
  recordEvolutionMetrics,
  saveEvolutionMetrics,
  writeEvolutionComparisonReport,
} from "./metrics.js";
import { isOperationalFailureNoise } from "./noise.js";
import { buildReflectionEvent } from "./reflect.js";
import { runEvolutionCycle } from "./runtime.js";
import type { ReflectionEvent, WorkflowCandidate } from "./types.js";
import { buildWorkflowCandidateFromExecution } from "./workflow-compiler.js";
import {
  loadWorkflowRegistry,
  saveWorkflowRegistry,
  toWorkflowCountMap,
  upsertWorkflowSuccess,
} from "./workflow-registry.js";

const log = createSubsystemLogger("evolution/auto");
const evolutionQueues = new Map<string, Promise<void>>();

function enqueueEvolutionWork(queueKey: string, work: () => Promise<void>): void {
  const previous = evolutionQueues.get(queueKey) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(work)
    .finally(() => {
      if (evolutionQueues.get(queueKey) === next) {
        evolutionQueues.delete(queueKey);
      }
    });
  evolutionQueues.set(queueKey, next);
}

function summarizeTaskOutcome(task: TaskRecord): string {
  return (
    task.terminalSummary?.trim() ||
    task.progressSummary?.trim() ||
    task.error?.trim() ||
    `${task.status} without summary`
  );
}

function normalizeSignatureToken(value: string | undefined): string {
  return (
    (value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "general"
  );
}

function buildTaskFailureSignatures(task: TaskRecord, succeeded: boolean): string[] {
  if (succeeded) {
    return [];
  }
  const terminalKind = task.terminalOutcome === "blocked" ? "blocked" : task.status;
  const scope = normalizeSignatureToken(task.taskKind ?? task.label ?? task.task);
  return [`task:${task.runtime}:${terminalKind}:${scope}`];
}

function buildWorkflowReuseKey(candidate: WorkflowCandidate | undefined): string | undefined {
  if (!candidate) {
    return undefined;
  }
  const title = candidate.title.trim();
  const trigger = candidate.trigger.trim();
  if (!title || !trigger) {
    return undefined;
  }
  return `${title}::${trigger}`;
}

export function maybeTriggerEvolutionForTasks(tasks: TaskRecord[] | undefined): void {
  for (const task of tasks ?? []) {
    enqueueEvolutionForTask(task);
  }
}

function enqueueEvolutionForTask(task: TaskRecord): void {
  const cfg = getRuntimeConfigSnapshot();
  if (!cfg) {
    return;
  }
  const agentId =
    task.agentId ||
    (task.childSessionKey ? resolveAgentIdFromSessionKey(task.childSessionKey) : undefined) ||
    resolveAgentIdFromSessionKey(task.requesterSessionKey);
  const queueKey = resolveAgentWorkspaceDir(cfg, agentId);
  enqueueEvolutionWork(queueKey, () => triggerEvolutionForTask(task, cfg, agentId));
}

function extractVisibleReplyText(reply: ReplyPayload | ReplyPayload[]): string | undefined {
  const payloads = Array.isArray(reply) ? reply : [reply];
  const joined = payloads
    .flatMap((payload) => {
      if (
        payload.isReasoning === true ||
        payload.isCompactionNotice === true ||
        typeof payload.text !== "string"
      ) {
        return [];
      }
      const text = payload.text.trim();
      return text ? [text] : [];
    })
    .join("\n")
    .trim();
  if (!joined) {
    return undefined;
  }
  if (isSilentReplyPayloadText(joined)) {
    return undefined;
  }
  const withoutSilent = stripLeadingSilentToken(stripSilentToken(joined)).trim();
  if (!withoutSilent || isSilentReplyPayloadText(withoutSilent)) {
    return undefined;
  }
  return withoutSilent;
}

type TriggerEvolutionForEventParams = {
  cfg: OpenClawConfig;
  sessionKey?: string;
  agentId?: string;
  workspaceDir?: string;
  event: ReflectionEvent;
  workflowKey?: string;
};

async function triggerEvolutionForEvent(params: TriggerEvolutionForEventParams): Promise<void> {
  const agentId =
    params.agentId ??
    resolveAgentIdFromSessionKey(params.sessionKey ?? params.event.sessionKey ?? undefined);
  const evolution = resolveEvolutionConfig(params.cfg, agentId);
  if (!evolution.enabled) {
    return;
  }
  const workspaceDir = params.workspaceDir ?? resolveAgentWorkspaceDir(params.cfg, agentId);
  const nowMs = params.event.createdAt;

  let workflowRegistry = await loadWorkflowRegistry(workspaceDir);
  const workflowKey =
    params.event.succeeded &&
    (buildWorkflowReuseKey(params.event.candidateWorkflow) ?? params.workflowKey);
  if (workflowKey) {
    workflowRegistry = upsertWorkflowSuccess({
      entries: workflowRegistry,
      key: workflowKey,
      nowMs,
      workflow: params.event.candidateWorkflow,
      outcomeSummary: params.event.outcomeSummary,
    });
    await saveWorkflowRegistry(workspaceDir, workflowRegistry);
  }

  const result = await runEvolutionCycle({
    workspaceDir,
    event: params.event,
    workflowReuseCounts: toWorkflowCountMap(workflowRegistry),
    minRuleRepetition: evolution.minRuleRepetition,
    minSkillRepetition: evolution.minSkillRepetition,
    autoPromote: {
      daily_memory: evolution.autoPromoteDailyMemory,
      memory: evolution.autoPromoteMemory,
      user_profile: evolution.autoPromoteUserProfile,
      rule_proposal: evolution.autoPromoteRules,
      skill_proposal: evolution.autoPromoteSkills,
    },
    nowMs,
  });

  const repeatedFailures = params.event.failureSignatures.filter((signature) => {
    return (result.failureCountBySignature.get(signature) ?? 0) > 1;
  }).length;
  const recoveredFailures =
    params.event.succeeded && params.event.failureSignatures.length > 0 ? 1 : 0;
  const metrics = await loadEvolutionMetrics(workspaceDir);
  const nextMetrics = recordEvolutionMetrics({
    state: metrics,
    event: params.event,
    candidateKinds: result.candidates.map((candidate) => candidate.kind),
    appliedKinds: result.appliedKinds,
    repeatedFailures,
    recoveredFailures,
    nowMs,
  });
  await saveEvolutionMetrics(workspaceDir, nextMetrics);
  await writeEvolutionComparisonReport(workspaceDir, nextMetrics);
}

export function maybeTriggerEvolutionForEvent(params: TriggerEvolutionForEventParams): void {
  const agentId =
    params.agentId ??
    resolveAgentIdFromSessionKey(params.sessionKey ?? params.event.sessionKey ?? undefined);
  const workspaceDir = params.workspaceDir ?? resolveAgentWorkspaceDir(params.cfg, agentId);
  enqueueEvolutionWork(workspaceDir, async () => {
    try {
      await triggerEvolutionForEvent({
        ...params,
        agentId,
        workspaceDir,
      });
    } catch (error) {
      log.warn("Failed to auto-trigger evolution event", {
        source: params.event.source,
        sessionKey: params.sessionKey ?? params.event.sessionKey,
        taskId: params.event.taskId,
        subagentId: params.event.subagentId,
        error,
      });
    }
  });
}

export function maybeTriggerEvolutionForReplyRun(params: {
  cfg: OpenClawConfig;
  sessionKey?: string;
  agentId?: string;
  workspaceDir?: string;
  promptSummary: string;
  reply: ReplyPayload | ReplyPayload[];
  isHeartbeat?: boolean;
}): void {
  const agentId = params.agentId ?? resolveAgentIdFromSessionKey(params.sessionKey ?? undefined);
  const evolution = resolveEvolutionConfig(params.cfg, agentId);
  if (!evolution.enabled) {
    return;
  }
  if (params.isHeartbeat && !evolution.reflectOnHeartbeat) {
    return;
  }
  const visibleReply = extractVisibleReplyText(params.reply);
  if (!visibleReply) {
    return;
  }
  const normalizedReply = params.isHeartbeat
    ? stripHeartbeatToken(visibleReply, { mode: "heartbeat" })
    : stripHeartbeatToken(visibleReply, { mode: "message" });
  if (normalizedReply.shouldSkip) {
    return;
  }
  const outcomeSummary = (normalizedReply.text || visibleReply).trim();
  if (!outcomeSummary) {
    return;
  }
  const workspaceDir = params.workspaceDir ?? resolveAgentWorkspaceDir(params.cfg, agentId);
  const nowMs = Date.now();
  const candidateWorkflow = params.isHeartbeat
    ? undefined
    : buildWorkflowCandidateFromExecution({
        task: params.promptSummary,
        summary: outcomeSummary,
        runtime: "reply",
      });
  const event = buildReflectionEvent({
    source: params.isHeartbeat ? "heartbeat" : "task",
    nowMs,
    sessionKey: params.sessionKey,
    promptSummary: params.promptSummary,
    outcomeSummary,
    succeeded: true,
    whatWorked: [outcomeSummary],
    candidateWorkflow,
    confidence: params.isHeartbeat ? 0.72 : 0.78,
    provenance: {
      messageCount: Array.isArray(params.reply) ? params.reply.length : 1,
    },
  });
  maybeTriggerEvolutionForEvent({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    agentId,
    workspaceDir,
    event,
  });
}

async function triggerEvolutionForTask(
  task: TaskRecord,
  cfg = getRuntimeConfigSnapshot(),
  agentId: string | undefined = task.agentId ||
    (task.childSessionKey ? resolveAgentIdFromSessionKey(task.childSessionKey) : undefined) ||
    resolveAgentIdFromSessionKey(task.requesterSessionKey),
): Promise<void> {
  try {
    if (!cfg) {
      return;
    }
    const evolution = resolveEvolutionConfig(cfg, agentId);
    if (!evolution.enabled) {
      return;
    }
    if (task.runtime === "subagent" && !evolution.reflectOnSubagentComplete) {
      return;
    }
    if (task.runtime !== "subagent" && !evolution.reflectOnTaskComplete) {
      return;
    }

    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const nowMs = task.endedAt ?? task.lastEventAt ?? Date.now();
    const summary = summarizeTaskOutcome(task);
    const succeeded = task.status === "succeeded" && task.terminalOutcome !== "blocked";
    const isOperationalNoise = isOperationalFailureNoise(summary);
    const failureSignatures =
      succeeded || isOperationalNoise ? [] : buildTaskFailureSignatures(task, succeeded);

    const candidateWorkflow = succeeded
      ? buildWorkflowCandidateFromExecution({
          task: task.task,
          taskLabel: task.label,
          summary,
          error: task.error,
          runtime: task.runtime,
        })
      : undefined;
    const event = buildReflectionEvent({
      source: task.runtime === "subagent" ? "subagent" : "task",
      nowMs,
      sessionKey: task.childSessionKey ?? task.requesterSessionKey,
      taskId: task.taskId,
      subagentId: task.runtime === "subagent" ? task.childSessionKey : undefined,
      promptSummary: task.task,
      outcomeSummary: summary,
      succeeded,
      whatWorked: succeeded ? [summary] : [],
      whatFailed: succeeded || isOperationalNoise ? [] : [summary],
      durableFacts: succeeded && task.runtime === "subagent" ? [summary] : [],
      userPreferences: [],
      candidateRules:
        failureSignatures.length > 0
          ? [
              `When "${task.task}" ends as ${task.status}, inspect the terminal summary before retrying. Latest signal: ${summary}`,
            ]
          : [],
      failureSignatures,
      candidateWorkflow,
      confidence: succeeded ? 0.8 : 0.72,
      provenance: {
        sourceFiles: [],
        artifactPaths: [],
      },
    });
    await triggerEvolutionForEvent({
      cfg,
      agentId,
      workspaceDir,
      event,
      workflowKey: buildWorkflowReuseKey(candidateWorkflow),
    });
  } catch (error) {
    log.warn("Failed to auto-trigger evolution for detached task", {
      taskId: task.taskId,
      runtime: task.runtime,
      error,
    });
  }
}
