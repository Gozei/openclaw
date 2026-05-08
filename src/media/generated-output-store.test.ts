import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { saveGeneratedOutput } from "./generated-output-store.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("saveGeneratedOutput", () => {
  it("writes configured generated outputs by agent, month, and kind", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-generated-output-"));
    const cfg = {
      tools: {
        media: {
          generatedOutputRoot: root,
        },
      },
    } satisfies OpenClawConfig;

    const saved = await saveGeneratedOutput({
      cfg,
      buffer: Buffer.from("image-bytes"),
      mimeType: "image/png",
      fallbackSubdir: "tool-image-generation",
      maxBytes: 1024,
      filenameHint: "draft logo.png",
      kind: "image",
      agentId: "Design Agent",
      sessionId: "session/alpha",
      provider: "openai",
      model: "gpt-image-1",
      prompt: "make a logo",
    });

    const currentMonth = new Date().toISOString().slice(0, 7);
    const outputDir = path.join(root, "Design-Agent", currentMonth);
    expect(saved.path).toBe(path.join(outputDir, "images", "draft-logo.png"));
    expect(await fs.readFile(saved.path, "utf8")).toBe("image-bytes");

    const manifest = await fs.readFile(path.join(outputDir, "manifest.jsonl"), "utf8");
    const entry = JSON.parse(manifest.trim()) as Record<string, unknown>;
    expect(entry).toMatchObject({
      agentId: "Design-Agent",
      sessionId: "session-alpha",
      kind: "image",
      path: saved.path,
      mimeType: "image/png",
      size: 11,
      provider: "openai",
      model: "gpt-image-1",
      prompt: "make a logo",
    });
  });

  it("adds numeric suffixes when generated output names collide", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-generated-collision-"));
    const cfg = {
      tools: {
        media: {
          generatedOutputRoot: root,
        },
      },
    } satisfies OpenClawConfig;

    const first = await saveGeneratedOutput({
      cfg,
      buffer: Buffer.from("first"),
      mimeType: "text/plain",
      fallbackSubdir: "tool-file-output",
      filenameHint: "report.txt",
      preferFilenameExtension: true,
      kind: "file",
      agentId: "Writer",
    });
    const second = await saveGeneratedOutput({
      cfg,
      buffer: Buffer.from("second"),
      mimeType: "text/plain",
      fallbackSubdir: "tool-file-output",
      filenameHint: "report.txt",
      preferFilenameExtension: true,
      kind: "file",
      agentId: "Writer",
    });

    expect(path.basename(first.path)).toBe("report.txt");
    expect(path.basename(second.path)).toBe("report (1).txt");
    expect(await fs.readFile(second.path, "utf8")).toBe("second");
  });

  it("falls back to the managed media store when no generated output root is configured", async () => {
    const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-generated-fallback-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateRoot);

    const saved = await saveGeneratedOutput({
      cfg: {},
      buffer: Buffer.from("track"),
      mimeType: "audio/mpeg",
      fallbackSubdir: "tool-music-generation",
      maxBytes: 1024,
      filenameHint: "theme.mp3",
      kind: "music",
    });

    expect(saved.path).toContain(`${path.sep}tool-music-generation${path.sep}`);
  });
});
