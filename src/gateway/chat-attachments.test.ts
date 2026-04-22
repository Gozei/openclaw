import { describe, expect, it, vi } from "vitest";
import {
  buildMessageWithAttachments,
  type ChatAttachment,
  parseMessageWithAttachments,
  resolveGatewayAttachmentMaxBytes,
} from "./chat-attachments.js";

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

async function parseWithWarnings(message: string, attachments: ChatAttachment[]) {
  const logs: string[] = [];
  const parsed = await parseMessageWithAttachments(message, attachments, {
    log: { warn: (warning) => logs.push(warning) },
  });
  return { parsed, logs };
}

describe("buildMessageWithAttachments", () => {
  it("embeds a single image as data URL", () => {
    const msg = buildMessageWithAttachments("see this", [
      {
        type: "image",
        mimeType: "image/png",
        fileName: "dot.png",
        content: PNG_1x1,
      },
    ]);
    expect(msg).toContain("see this");
    expect(msg).toContain(`data:image/png;base64,${PNG_1x1}`);
    expect(msg).toContain("![dot.png]");
  });

  it("rejects non-image mime types", () => {
    const bad: ChatAttachment = {
      type: "file",
      mimeType: "application/pdf",
      fileName: "a.pdf",
      content: "AAA",
    };
    expect(() => buildMessageWithAttachments("x", [bad])).toThrow(/image/);
  });
});

describe("parseMessageWithAttachments", () => {
  it("uses a 10MB default attachment limit and honors gateway config overrides", () => {
    expect(resolveGatewayAttachmentMaxBytes({})).toBe(10_000_000);
    expect(
      resolveGatewayAttachmentMaxBytes({
        gateway: { attachments: { maxBytes: 15_000_000 } },
      }),
    ).toBe(15_000_000);
  });

  it("strips data URL prefix", async () => {
    const parsed = await parseMessageWithAttachments(
      "see this",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "dot.png",
          content: `data:image/png;base64,${PNG_1x1}`,
        },
      ],
      { log: { warn: () => {} } },
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
  });

  it("sniffs mime when missing", async () => {
    const { parsed, logs } = await parseWithWarnings("see this", [
      {
        type: "image",
        fileName: "dot.png",
        content: PNG_1x1,
      },
    ]);
    expect(parsed.message).toBe("see this");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(logs).toHaveLength(0);
  });

  it("drops non-image payloads and logs", async () => {
    const pdf = Buffer.from("%PDF-1.4\n").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "file",
        mimeType: "image/png",
        fileName: "not-image.pdf",
        content: pdf,
      },
    ]);
    expect(parsed.images).toHaveLength(0);
    expect(parsed.savedAttachments).toHaveLength(1);
    expect(parsed.savedAttachments[0]?.mimeType).toBe("application/pdf");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/mime mismatch/i);
  });

  it("prefers sniffed mime type and logs mismatch", async () => {
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "image",
        mimeType: "image/jpeg",
        fileName: "dot.png",
        content: PNG_1x1,
      },
    ]);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/mime mismatch/i);
  });

  it("drops unknown mime when sniff fails and logs", async () => {
    const unknown = Buffer.from("not an image").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      { type: "file", fileName: "unknown.bin", content: unknown },
    ]);
    expect(parsed.images).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/unsupported attachment type/i);
  });

  it("keeps valid images and drops invalid ones", async () => {
    const pdf = Buffer.from("%PDF-1.4\n").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "image",
        mimeType: "image/png",
        fileName: "dot.png",
        content: PNG_1x1,
      },
      {
        type: "file",
        mimeType: "image/png",
        fileName: "not-image.pdf",
        content: pdf,
      },
    ]);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.savedAttachments).toHaveLength(1);
    expect(parsed.savedAttachments[0]?.mimeType).toBe("application/pdf");
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(logs.some((l) => /mime mismatch/i.test(l))).toBe(true);
  });

  it("accepts text documents as saved attachments", async () => {
    const markdown = Buffer.from("# Notes\n\nhello").toString("base64");
    const { parsed, logs } = await parseWithWarnings("check this", [
      {
        type: "document",
        mimeType: "text/markdown",
        fileName: "notes.md",
        content: markdown,
      },
    ]);
    expect(parsed.message).toBe("check this");
    expect(parsed.images).toHaveLength(0);
    expect(parsed.savedAttachments).toHaveLength(1);
    expect(parsed.savedAttachments[0]?.mimeType).toBe("text/markdown");
    expect(parsed.attachmentOrder).toEqual(["saved"]);
    expect(logs).toHaveLength(0);
  });

  it("accepts zip uploads as saved attachments", async () => {
    const zip = Buffer.from("PK\x03\x04hello").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "document",
        mimeType: "application/zip",
        fileName: "bundle.zip",
        content: zip,
      },
    ]);
    expect(parsed.images).toHaveLength(0);
    expect(parsed.savedAttachments).toHaveLength(1);
    expect(parsed.savedAttachments[0]?.mimeType).toBe("application/zip");
    expect(logs).toHaveLength(0);
  });

  it("keeps specific Office MIME types when sniffing only sees the zip container", async () => {
    const docxContainer = Buffer.from("PK\x03\x04hello").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "document",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileName: "brief.docx",
        content: docxContainer,
      },
    ]);

    expect(parsed.images).toHaveLength(0);
    expect(parsed.savedAttachments).toHaveLength(1);
    expect(parsed.savedAttachments[0]?.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(parsed.savedAttachments[0]?.label).toBe("brief.docx");
    expect(logs).toHaveLength(0);
  });

  it("still drops unsupported archive uploads with a warning", async () => {
    const archive = Buffer.from("PK\x03\x04hello").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "document",
        mimeType: "application/x-7z-compressed",
        fileName: "bundle.7z",
        content: archive,
      },
    ]);
    expect(parsed.images).toHaveLength(0);
    expect(parsed.savedAttachments).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/unsupported attachment type/i);
  });
});

describe("shared attachment validation", () => {
  it("rejects invalid base64 content for both builder and parser", async () => {
    const bad: ChatAttachment = {
      type: "image",
      mimeType: "image/png",
      fileName: "dot.png",
      content: "%not-base64%",
    };

    expect(() => buildMessageWithAttachments("x", [bad])).toThrow(/base64/i);
    await expect(
      parseMessageWithAttachments("x", [bad], { log: { warn: () => {} } }),
    ).rejects.toThrow(/base64/i);
  });

  it("rejects images over limit for both builder and parser without decoding base64", async () => {
    const big = "A".repeat(10_000);
    const att: ChatAttachment = {
      type: "image",
      mimeType: "image/png",
      fileName: "big.png",
      content: big,
    };

    const fromSpy = vi.spyOn(Buffer, "from");
    try {
      expect(() => buildMessageWithAttachments("x", [att], { maxBytes: 16 })).toThrow(
        /exceeds size limit/i,
      );
      await expect(
        parseMessageWithAttachments("x", [att], { maxBytes: 16, log: { warn: () => {} } }),
      ).rejects.toThrow(/exceeds size limit/i);
      const base64Calls = fromSpy.mock.calls.filter((args) => (args as unknown[])[1] === "base64");
      expect(base64Calls).toHaveLength(0);
    } finally {
      fromSpy.mockRestore();
    }
  });
});
