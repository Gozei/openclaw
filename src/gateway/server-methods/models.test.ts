import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCatalogEntry } from "../../agents/model-catalog.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({})),
  buildAllowedModelSet: vi.fn(() => ({
    allowAny: true,
    allowedCatalog: [] as ModelCatalogEntry[],
  })),
  buildConfiguredModelCatalog: vi.fn(() => [] as ModelCatalogEntry[]),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../../agents/model-selection.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/model-selection.js")>(
    "../../agents/model-selection.js",
  );
  return {
    ...actual,
    buildAllowedModelSet: mocks.buildAllowedModelSet,
    buildConfiguredModelCatalog: mocks.buildConfiguredModelCatalog,
  };
});

import { modelsHandlers } from "./models.ts";

function createOptions(params: Record<string, unknown> = {}, catalog: ModelCatalogEntry[] = []) {
  const respond = vi.fn();
  return {
    req: { type: "req", id: "req-1", method: "models.list", params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {
      loadGatewayModelCatalog: vi.fn(async () => catalog),
    },
  } as unknown as GatewayRequestHandlerOptions & { respond: ReturnType<typeof vi.fn> };
}

const handler = modelsHandlers["models.list"];

describe("models.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({});
    mocks.buildAllowedModelSet.mockReturnValue({ allowAny: true, allowedCatalog: [] });
    mocks.buildConfiguredModelCatalog.mockReturnValue([]);
  });

  it("returns the runtime catalog by default", async () => {
    const catalog: ModelCatalogEntry[] = [
      { provider: "openai", id: "gpt-5.4", name: "GPT-5.4" },
      { provider: "anthropic", id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    ];
    const opts = createOptions({}, catalog);

    await handler(opts);

    const [ok, payload] = opts.respond.mock.calls[0] ?? [];
    expect(ok).toBe(true);
    expect(payload).toEqual({ models: catalog });
  });

  it("returns the configured subset for picker callers", async () => {
    const catalog: ModelCatalogEntry[] = [
      { provider: "amazon-bedrock", id: "claude-opus", name: "Claude Opus (Bedrock)" },
      { provider: "custom", id: "qwen-plus", name: "Qwen Plus (runtime)" },
      { provider: "ollama", id: "qwen2.5:7b", name: "Qwen 2.5 7B (runtime)" },
    ];
    mocks.buildConfiguredModelCatalog.mockReturnValue([
      { provider: "custom", id: "qwen-plus", name: "Qwen Plus (config)" },
      { provider: "ollama", id: "qwen2.5:7b", name: "Qwen 2.5 7B (config)" },
    ]);
    const opts = createOptions({ configuredOnly: true }, catalog);

    await handler(opts);

    const [ok, payload] = opts.respond.mock.calls[0] ?? [];
    expect(ok).toBe(true);
    expect(payload).toEqual({
      models: [
        { provider: "custom", id: "qwen-plus", name: "Qwen Plus (runtime)" },
        { provider: "ollama", id: "qwen2.5:7b", name: "Qwen 2.5 7B (runtime)" },
      ],
    });
  });

  it("prefers the allowlist subset when one is configured", async () => {
    const allowedCatalog: ModelCatalogEntry[] = [
      { provider: "openai", id: "gpt-5.4", name: "GPT-5.4" },
    ];
    mocks.buildAllowedModelSet.mockReturnValue({ allowAny: false, allowedCatalog });
    mocks.buildConfiguredModelCatalog.mockReturnValue([
      { provider: "custom", id: "qwen-plus", name: "Qwen Plus" },
    ]);
    const opts = createOptions({ configuredOnly: true }, [
      { provider: "openai", id: "gpt-5.4", name: "GPT-5.4" },
      { provider: "custom", id: "qwen-plus", name: "Qwen Plus" },
    ]);

    await handler(opts);

    const [ok, payload] = opts.respond.mock.calls[0] ?? [];
    expect(ok).toBe(true);
    expect(payload).toEqual({ models: allowedCatalog });
  });
});
