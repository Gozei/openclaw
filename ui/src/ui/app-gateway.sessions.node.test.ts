import { describe, expect, it, vi } from "vitest";

const loadSessionsMock = vi.fn();
const loadChatHistoryMock = vi.fn();

vi.mock("./app-chat.ts", () => ({
  CHAT_SESSIONS_ACTIVE_MINUTES: 10,
  flushChatQueueForEvent: vi.fn(),
}));
vi.mock("./app-settings.ts", () => ({
  applySettings: vi.fn(),
  loadCron: vi.fn(),
  refreshActiveTab: vi.fn(),
  setLastActiveSessionKey: vi.fn(),
}));
vi.mock("./app-tool-stream.ts", () => ({
  handleAgentEvent: vi.fn(),
  resetToolStream: vi.fn(),
}));
vi.mock("./controllers/agents.ts", () => ({
  loadAgents: vi.fn(),
  loadToolsCatalog: vi.fn(),
}));
vi.mock("./controllers/assistant-identity.ts", () => ({
  loadAssistantIdentity: vi.fn(),
}));
vi.mock("./controllers/chat.ts", () => ({
  loadChatHistory: loadChatHistoryMock,
  handleChatEvent: vi.fn(() => "idle"),
}));
vi.mock("./controllers/devices.ts", () => ({
  loadDevices: vi.fn(),
}));
vi.mock("./controllers/exec-approval.ts", () => ({
  addExecApproval: vi.fn(),
  parseExecApprovalRequested: vi.fn(() => null),
  parseExecApprovalResolved: vi.fn(() => null),
  removeExecApproval: vi.fn(),
}));
vi.mock("./controllers/nodes.ts", () => ({
  loadNodes: vi.fn(),
}));
vi.mock("./controllers/sessions.ts", () => ({
  loadSessions: loadSessionsMock,
  subscribeSessions: vi.fn(),
}));
vi.mock("./gateway.ts", () => ({
  GatewayBrowserClient: function GatewayBrowserClient() {},
  resolveGatewayErrorDetailCode: () => null,
}));

const { handleGatewayEvent } = await import("./app-gateway.ts");
const { addExecApproval } = await vi.importActual<typeof import("./controllers/exec-approval.ts")>(
  "./controllers/exec-approval.ts",
);

type TestGatewayHost = Parameters<typeof handleGatewayEvent>[0] & {
  chatMessages: unknown[];
  chatSending: boolean;
  chatStream: string | null;
  toolStreamOrder: string[];
};

function createHost(): TestGatewayHost {
  return {
    settings: {
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "claw",
      themeMode: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      chatShowToolCalls: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navWidth: 280,
      navGroupsCollapsed: {},
      borderRadius: 50,
    },
    password: "",
    clientInstanceId: "instance-test",
    client: null,
    connected: true,
    hello: null,
    lastError: null,
    lastErrorCode: null,
    eventLogBuffer: [],
    eventLog: [],
    tab: "overview",
    presenceEntries: [],
    presenceError: null,
    presenceStatus: null,
    agentsLoading: false,
    agentsList: null,
    agentsError: null,
    healthLoading: false,
    healthResult: null,
    healthError: null,
    toolsCatalogLoading: false,
    toolsCatalogError: null,
    toolsCatalogResult: null,
    debugHealth: null,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    assistantAgentId: null,
    serverVersion: null,
    sessionKey: "main",
    chatMessages: [],
    chatSending: false,
    chatStream: null,
    toolStreamOrder: [],
    chatRunId: null,
    refreshSessionsAfterChat: new Set<string>(),
    execApprovalQueue: [],
    execApprovalError: null,
    updateAvailable: null,
  } as unknown as TestGatewayHost;
}

describe("handleGatewayEvent sessions.changed", () => {
  it("reloads sessions when the gateway pushes a sessions.changed event", () => {
    loadSessionsMock.mockReset();
    const host = createHost();

    handleGatewayEvent(host, {
      type: "event",
      event: "sessions.changed",
      payload: { sessionKey: "agent:main:main", reason: "patch" },
      seq: 1,
    });

    expect(loadSessionsMock).toHaveBeenCalledTimes(1);
    expect(loadSessionsMock).toHaveBeenCalledWith(host);
  });

  it("patches an already loaded session row in place when the payload has a matching session key", () => {
    loadSessionsMock.mockReset();
    const host = createHost() as TestGatewayHost & {
      sessionsResult: {
        defaults: Record<string, unknown>;
        sessions: Array<Record<string, unknown>>;
      };
    };
    host.sessionsResult = {
      defaults: {},
      sessions: [
        {
          key: "agent:qa:main",
          kind: "direct",
          label: "Old label",
          updatedAt: 1,
          agentId: "agent-old",
          sessionRevision: 1,
        },
      ],
    };

    handleGatewayEvent(host, {
      type: "event",
      event: "sessions.changed",
      payload: {
        sessionKey: "agent:qa:main",
        kind: "direct",
        label: "Fresh label",
        updatedAt: 2,
        agentId: "agent-new",
        sessionRevision: 2,
      },
      seq: 1,
    });

    expect(loadSessionsMock).not.toHaveBeenCalled();
    expect(host.sessionsResult.sessions[0]).toMatchObject({
      key: "agent:qa:main",
      label: "Fresh label",
      updatedAt: 2,
      agentId: "agent-new",
      sessionRevision: 2,
    });
  });

  it("reloads active chat history when session revisions skip ahead", () => {
    loadSessionsMock.mockReset();
    loadChatHistoryMock.mockReset();
    const host = createHost() as TestGatewayHost & {
      sessionsResult: {
        defaults: Record<string, unknown>;
        sessions: Array<Record<string, unknown>>;
      };
    };
    host.sessionKey = "agent:qa:main";
    host.sessionsResult = {
      defaults: {},
      sessions: [
        {
          key: "agent:qa:main",
          kind: "direct",
          label: "Old label",
          updatedAt: 1,
          sessionRevision: 1,
        },
      ],
    };

    handleGatewayEvent(host, {
      type: "event",
      event: "sessions.changed",
      payload: {
        sessionKey: "agent:qa:main",
        kind: "direct",
        label: "Fresh label",
        updatedAt: 2,
        sessionRevision: 3,
      },
      seq: 1,
    });

    expect(loadSessionsMock).not.toHaveBeenCalled();
    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
    expect(loadChatHistoryMock).toHaveBeenCalledWith(host);
    expect(host.sessionsResult.sessions[0]).toMatchObject({
      key: "agent:qa:main",
      label: "Fresh label",
      sessionRevision: 3,
    });
  });
});

describe("handleGatewayEvent session.message", () => {
  it("reloads chat history for the active session when only the session key is provided", () => {
    loadChatHistoryMock.mockReset();
    const host = createHost();
    host.sessionKey = "agent:qa:main";

    handleGatewayEvent(host, {
      type: "event",
      event: "session.message",
      payload: { sessionKey: "agent:qa:main" },
      seq: 1,
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
    expect(loadChatHistoryMock).toHaveBeenCalledWith(host);
  });

  it("does not reload history while the current run is still live", () => {
    loadChatHistoryMock.mockReset();
    const host = createHost();
    host.sessionKey = "agent:qa:main";
    host.chatRunId = "run-1";
    host.chatStream = "";

    handleGatewayEvent(host, {
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "agent:qa:main",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Working" }],
        },
      },
      seq: 1,
    });

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
  });

  it("does not reload history when the transcript event matches the already-rendered last message", () => {
    loadChatHistoryMock.mockReset();
    const host = createHost();
    host.sessionKey = "agent:qa:main";
    host.chatMessages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Final answer" }],
      },
    ];

    handleGatewayEvent(host, {
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "agent:qa:main",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Final answer" }],
        },
      },
      seq: 1,
    });

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
  });

  it("reloads history when the transcript event differs from the current rendered tail", () => {
    loadChatHistoryMock.mockReset();
    const host = createHost();
    host.sessionKey = "agent:qa:main";
    host.chatMessages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Old answer" }],
      },
    ];

    handleGatewayEvent(host, {
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "agent:qa:main",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Fresh answer" }],
        },
      },
      seq: 1,
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
    expect(loadChatHistoryMock).toHaveBeenCalledWith(host);
  });

  it("appends consecutive transcript updates directly into the active chat", () => {
    loadChatHistoryMock.mockReset();
    const host = createHost();
    host.sessionKey = "agent:qa:main";
    host.chatMessages = [
      {
        role: "user",
        content: [{ type: "text", text: "Hi" }],
        __openclaw: { id: "msg-1", seq: 1 },
      },
    ];

    handleGatewayEvent(host, {
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "agent:qa:main",
        messageId: "msg-2",
        messageSeq: 2,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello there" }],
        },
      },
      seq: 1,
    });

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
    expect(host.chatMessages).toHaveLength(2);
    expect(host.chatMessages[1]).toMatchObject({
      role: "assistant",
      __openclaw: { id: "msg-2", seq: 2 },
    });
  });

  it("reloads history when transcript updates arrive with a visible sequence gap", () => {
    loadChatHistoryMock.mockReset();
    const host = createHost();
    host.sessionKey = "agent:qa:main";
    host.chatMessages = [
      {
        role: "user",
        content: [{ type: "text", text: "Hi" }],
        __openclaw: { id: "msg-1", seq: 1 },
      },
    ];

    handleGatewayEvent(host, {
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "agent:qa:main",
        messageId: "msg-3",
        messageSeq: 3,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Skipped one" }],
        },
      },
      seq: 1,
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
    expect(loadChatHistoryMock).toHaveBeenCalledWith(host);
  });

  it("reloads history when session revisions skip ahead even without a transcript sequence gap", () => {
    loadChatHistoryMock.mockReset();
    const host = createHost() as TestGatewayHost & {
      sessionsResult: {
        defaults: Record<string, unknown>;
        sessions: Array<Record<string, unknown>>;
      };
    };
    host.sessionKey = "agent:qa:main";
    host.sessionsResult = {
      defaults: {},
      sessions: [
        {
          key: "agent:qa:main",
          kind: "direct",
          sessionRevision: 1,
        },
      ],
    };
    host.chatMessages = [
      {
        role: "user",
        content: [{ type: "text", text: "Hi" }],
        __openclaw: { id: "msg-1", seq: 1 },
      },
    ];

    handleGatewayEvent(host, {
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "agent:qa:main",
        messageId: "msg-2",
        messageSeq: 2,
        sessionRevision: 3,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello there" }],
        },
      },
      seq: 1,
    });

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
    expect(loadChatHistoryMock).toHaveBeenCalledWith(host);
  });

  it("ignores transcript updates for other sessions", () => {
    loadChatHistoryMock.mockReset();
    const host = createHost();
    host.sessionKey = "agent:qa:main";

    handleGatewayEvent(host, {
      type: "event",
      event: "session.message",
      payload: { sessionKey: "agent:qa:other" },
      seq: 1,
    });

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
  });
});

describe("addExecApproval", () => {
  it("keeps the newest approval at the front of the queue", () => {
    const queue = addExecApproval(
      [
        {
          id: "approval-old",
          kind: "exec",
          request: { command: "echo old" },
          createdAtMs: 1,
          expiresAtMs: Date.now() + 120_000,
        },
      ],
      {
        id: "approval-new",
        kind: "exec",
        request: { command: "echo new" },
        createdAtMs: 2,
        expiresAtMs: Date.now() + 120_000,
      },
    );

    expect(queue.map((entry) => entry.id)).toEqual(["approval-new", "approval-old"]);
  });
});
