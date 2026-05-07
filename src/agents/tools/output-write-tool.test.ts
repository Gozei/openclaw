import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createOutputWriteTool } from "./output-write-tool.js";

function firstText(
  result: Awaited<ReturnType<NonNullable<ReturnType<typeof createOutputWriteTool>["execute"]>>>,
) {
  const block = result.content?.find((item) => item?.type === "text");
  return block?.type === "text" ? block.text : "";
}

describe("createOutputWriteTool", () => {
  it("writes user-facing files under the configured output root by agent and kind", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-output-write-"));
    const tool = createOutputWriteTool({
      config: {
        tools: {
          media: {
            generatedOutputRoot: root,
          },
        },
      },
      agentId: "Writing Agent",
      sessionId: "session/main",
    });

    const result = await tool.execute("tool-call-1", {
      filename: "scripts/hello.py",
      content: 'print("hello")\n',
      mimeType: "text/x-python",
    });
    const details = result.details as { path: string; size: number; media?: { mediaUrl?: string } };
    const currentMonth = new Date().toISOString().slice(0, 7);

    expect(details.path).toBe(path.join(root, "Writing-Agent", currentMonth, "files", "hello.py"));
    expect(details.size).toBe(15);
    expect(details.media?.mediaUrl).toBe(details.path);
    expect(await fs.readFile(details.path, "utf8")).toBe('print("hello")\n');
    expect(firstText(result)).toContain(`MEDIA:${details.path}`);
  });

  it("supports base64 content for binary-like outputs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-output-write-base64-"));
    const tool = createOutputWriteTool({
      config: {
        tools: {
          media: {
            generatedOutputRoot: root,
          },
        },
      },
    });

    const result = await tool.execute("tool-call-1", {
      filename: "deck.ppt",
      content: Buffer.from([0, 1, 2, 3]).toString("base64"),
      encoding: "base64",
    });
    const details = result.details as { path: string };

    expect(details.path.endsWith(".ppt")).toBe(true);
    expect(await fs.readFile(details.path)).toEqual(Buffer.from([0, 1, 2, 3]));
  });
});
