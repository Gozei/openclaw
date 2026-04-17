import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../config/sessions/types.js";
import type { OpenClawConfig } from "../config/types.js";
import { listSessionsFromStore } from "./session-utils.js";
import { applySessionsPatchToStore } from "./sessions-patch.js";

const cfg = {
  session: { store: "/tmp/openclaw-sessions.json", mainKey: "main" },
  agents: {
    defaults: {
      model: { primary: "openai/gpt-test-a" },
    },
    list: [
      {
        id: "main",
        default: true,
        workspace: "/tmp/main",
        model: { primary: "openai/gpt-test-a" },
      },
      { id: "ops", workspace: "/tmp/ops", model: { primary: "anthropic/claude-ops" } },
    ],
  },
} satisfies OpenClawConfig;

describe("session agent overrides", () => {
  it("persists a session-scoped agent override without changing the store key", async () => {
    const store: Record<string, SessionEntry> = {
      "agent:main:main": {
        sessionId: "sess-main",
        updatedAt: 1,
      },
    };

    const result = await applySessionsPatchToStore({
      cfg,
      store,
      storeKey: "agent:main:main",
      patch: {
        key: "agent:main:main",
        agentId: "ops",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.entry.agentOverrideId).toBe("ops");
    expect(store["agent:main:main"]?.agentOverrideId).toBe("ops");
  });

  it("projects overridden agent identity and model through sessions.list", () => {
    const store: Record<string, SessionEntry> = {
      "agent:main:main": {
        sessionId: "sess-main",
        updatedAt: 1,
        agentOverrideId: "ops",
        totalTokens: 1,
        totalTokensFresh: true,
        contextTokens: 1024,
        estimatedCostUsd: 0,
      },
      "agent:ops:main": {
        sessionId: "sess-ops",
        updatedAt: 2,
        totalTokens: 1,
        totalTokensFresh: true,
        contextTokens: 1024,
        estimatedCostUsd: 0,
      },
    };

    const listed = listSessionsFromStore({
      cfg,
      storePath: "/tmp/openclaw-sessions.json",
      store,
      opts: {},
    });
    const overridden = listed.sessions.find((session) => session.key === "agent:main:main");
    expect(overridden?.agentId).toBe("ops");
    expect(overridden?.agentOverrideId).toBe("ops");
    expect(overridden?.modelProvider).toBe("anthropic");
    expect(overridden?.model).toBe("claude-ops");

    const filtered = listSessionsFromStore({
      cfg,
      storePath: "/tmp/openclaw-sessions.json",
      store,
      opts: { agentId: "ops" },
    });
    expect(filtered.sessions.map((session) => session.key).toSorted()).toEqual([
      "agent:main:main",
      "agent:ops:main",
    ]);
  }, 15000);
});
