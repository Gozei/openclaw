import { describe, expect, it, vi } from "vitest";
import { loadModels } from "./models.ts";

describe("models controller", () => {
  it("requests the picker-scoped catalog when configuredOnly is enabled", async () => {
    const request = vi.fn().mockResolvedValue({
      models: [{ provider: "ollama", id: "qwen2.5:7b", name: "Qwen 2.5 7B" }],
    });

    const result = await loadModels(
      {
        request,
      } as never,
      { configuredOnly: true },
    );

    expect(request).toHaveBeenCalledWith("models.list", { configuredOnly: true });
    expect(result).toEqual([{ provider: "ollama", id: "qwen2.5:7b", name: "Qwen 2.5 7B" }]);
  });

  it("falls back to the full catalog request shape by default", async () => {
    const request = vi.fn().mockResolvedValue({
      models: [{ provider: "openai", id: "gpt-5.4", name: "GPT-5.4" }],
    });

    await loadModels({
      request,
    } as never);

    expect(request).toHaveBeenCalledWith("models.list", {});
  });
});
