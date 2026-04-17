import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/agents/pi-embedded-runner.resolvesessionagentids.test.ts",
      "src/gateway/sessions-patch.agent-override.test.ts",
      "src/gateway/server.chat.gateway-server-chat.test.ts",
    ],
  },
});
