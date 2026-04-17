const sessionEventRevisions = new Map<string, number>();

function normalizeSessionEventRevisionKey(sessionKey: string | null | undefined): string | null {
  if (typeof sessionKey !== "string") {
    return null;
  }
  const normalized = sessionKey.trim();
  return normalized ? normalized : null;
}

export function peekSessionEventRevision(sessionKey: string | null | undefined): number {
  const key = normalizeSessionEventRevisionKey(sessionKey);
  if (!key) {
    return 0;
  }
  return sessionEventRevisions.get(key) ?? 0;
}

export function nextSessionEventRevision(
  sessionKey: string | null | undefined,
): number | undefined {
  const key = normalizeSessionEventRevisionKey(sessionKey);
  if (!key) {
    return undefined;
  }
  const nextRevision = (sessionEventRevisions.get(key) ?? 0) + 1;
  sessionEventRevisions.set(key, nextRevision);
  return nextRevision;
}

export function clearSessionEventRevisionsForTest(): void {
  sessionEventRevisions.clear();
}
