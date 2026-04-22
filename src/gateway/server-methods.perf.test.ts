import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLogger, setLoggerOverride } from "../logging.js";
import { registerLogTransport } from "../logging/logger.js";
import { handleGatewayRequest } from "./server-methods.js";
import type { GatewayRequestContext } from "./server-methods/types.js";

afterEach(() => {
  setLoggerOverride(null);
  resetLogger();
});

describe("gateway perf instrumentation", () => {
  it("emits a total request perf event for successful responses", async () => {
    setLoggerOverride({ level: "debug", consoleLevel: "silent" });
    const records: Record<string, unknown>[] = [];
    const unregister = registerLogTransport((record) => {
      records.push(record);
    });

    try {
      const respond = vi.fn();
      await handleGatewayRequest({
        req: { type: "req", id: "req-perf-1", method: "ping" },
        respond,
        client: null,
        isWebchatConnect: () => false,
        extraHandlers: {
          ping: ({ respond }) => {
            respond(true, { ok: true });
          },
        },
        context: { logGateway: { warn: vi.fn() } } as unknown as GatewayRequestContext,
      });
    } finally {
      unregister();
    }

    const perfRecord = records.find(
      (record) => (record[1] as { name?: string } | undefined)?.name === "gateway.request.total",
    );
    expect(perfRecord?.[1]).toMatchObject({
      kind: "perf",
      name: "gateway.request.total",
      requestId: "req-perf-1",
      method: "ping",
      outcome: "ok",
    });
  });
});
