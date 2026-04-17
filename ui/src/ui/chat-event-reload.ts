import type { ChatEventPayload } from "./controllers/chat.ts";

export function shouldReloadHistoryForFinalEvent(payload?: ChatEventPayload): boolean {
  if (!payload || payload.state !== "final") {
    return false;
  }
  if (!payload.message || typeof payload.message !== "object") {
    return true;
  }
  const role = (payload.message as { role?: unknown }).role;
  return typeof role !== "string" || role.trim().toLowerCase() !== "assistant";
}
