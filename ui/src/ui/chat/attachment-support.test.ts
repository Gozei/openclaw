import { describe, expect, it } from "vitest";
import {
  CHAT_ATTACHMENT_ACCEPT,
  isSupportedChatAttachmentMimeType,
  resolveSupportedChatAttachmentKind,
} from "./attachment-support.ts";

describe("chat attachment support", () => {
  it("supports images, audio, video, and common document mimes", () => {
    expect(resolveSupportedChatAttachmentKind({ mimeType: "image/png" })).toBe("image");
    expect(resolveSupportedChatAttachmentKind({ mimeType: "audio/ogg" })).toBe("audio");
    expect(resolveSupportedChatAttachmentKind({ mimeType: "video/mp4" })).toBe("video");
    expect(resolveSupportedChatAttachmentKind({ mimeType: "application/pdf" })).toBe("document");
    expect(resolveSupportedChatAttachmentKind({ mimeType: "text/plain" })).toBe("document");
  });

  it("falls back to file extension for browsers that omit document mime types", () => {
    expect(resolveSupportedChatAttachmentKind({ mimeType: "", fileName: "notes.md" })).toBe(
      "document",
    );
    expect(resolveSupportedChatAttachmentKind({ mimeType: "", fileName: "slides.pptx" })).toBe(
      "document",
    );
  });

  it("allows zip uploads but still blocks other archive formats", () => {
    expect(isSupportedChatAttachmentMimeType("application/zip", "bundle.zip")).toBe(true);
    expect(
      resolveSupportedChatAttachmentKind({ mimeType: "application/zip", fileName: "bundle.zip" }),
    ).toBe("document");
    expect(resolveSupportedChatAttachmentKind({ mimeType: "application/x-7z-compressed" })).toBe(
      undefined,
    );
  });

  it("exports a file picker accept string that includes document types", () => {
    expect(CHAT_ATTACHMENT_ACCEPT).toContain("image/*");
    expect(CHAT_ATTACHMENT_ACCEPT).toContain("application/pdf");
    expect(CHAT_ATTACHMENT_ACCEPT).toContain(".docx");
    expect(CHAT_ATTACHMENT_ACCEPT).toContain(".zip");
  });
});
