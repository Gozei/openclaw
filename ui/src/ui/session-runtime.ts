import { resolveAgentIdFromSessionKey } from "./session-key.ts";
import { normalizeOptionalString } from "./string-coerce.ts";
import type { GatewaySessionRow, SessionsListResult } from "./types.ts";

export function findSessionRow(
  sessionsResult: SessionsListResult | null | undefined,
  sessionKey: string | null | undefined,
): GatewaySessionRow | undefined {
  const key = normalizeOptionalString(sessionKey);
  if (!key) {
    return undefined;
  }
  return sessionsResult?.sessions?.find((row) => row.key === key);
}

export function resolveEffectiveSessionAgentId(params: {
  sessionKey: string | null | undefined;
  sessionsResult?: SessionsListResult | null;
  defaultAgentId?: string | null;
}): string | null {
  const rowAgentId = normalizeOptionalString(
    findSessionRow(params.sessionsResult ?? null, params.sessionKey)?.agentId,
  );
  if (rowAgentId) {
    return rowAgentId;
  }
  const key = normalizeOptionalString(params.sessionKey);
  if (key) {
    return resolveAgentIdFromSessionKey(key);
  }
  return normalizeOptionalString(params.defaultAgentId) ?? null;
}
