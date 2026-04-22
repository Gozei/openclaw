import { describe, expect, it } from "vitest";
import { finalizeInboundContext } from "./reply/inbound-context.js";
import { buildReplyPromptBodies } from "./reply/prompt-prelude.js";

describe("getReplyFromConfig media note plumbing", () => {
  it("includes all MediaPaths in the agent prompt", () => {
    const sessionCtx = finalizeInboundContext({
      Body: "hello",
      BodyForAgent: "hello",
      From: "+1001",
      To: "+2000",
      MediaPaths: ["/tmp/a.png", "/tmp/b.png"],
      MediaUrls: ["/tmp/a.png", "/tmp/b.png"],
    });
    const prompt = buildReplyPromptBodies({
      ctx: sessionCtx,
      sessionCtx,
      effectiveBaseBody: sessionCtx.BodyForAgent,
      prefixedBody: sessionCtx.BodyForAgent,
    }).prefixedCommandBody;

    expect(prompt).toContain("[media attached: 2 files]");
    const idxA = prompt.indexOf("[media attached 1/2: /tmp/a.png");
    const idxB = prompt.indexOf("[media attached 2/2: /tmp/b.png");
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxB);
    expect(prompt).toContain("hello");
  });

  it("keeps the real image attachment note after image understanding rewrites the body", () => {
    const describedBody = [
      "[Image]",
      "User text:",
      "make this widescreen",
      "Description:",
      "a red barn at sunset",
    ].join("\n");
    const sessionCtx = finalizeInboundContext({
      Body: describedBody,
      BodyForAgent: describedBody,
      From: "+1001",
      To: "+2000",
      MediaPaths: ["/tmp/media-store/real-image.png"],
      MediaUrls: ["https://example.com/real-image.png"],
      MediaTypes: ["image/png"],
      MediaUnderstanding: [
        {
          kind: "image.description",
          attachmentIndex: 0,
          text: "a red barn at sunset",
          provider: "openai",
        },
      ],
    });
    const prompt = buildReplyPromptBodies({
      ctx: sessionCtx,
      sessionCtx,
      effectiveBaseBody: sessionCtx.BodyForAgent,
      prefixedBody: sessionCtx.BodyForAgent,
    }).prefixedCommandBody;

    expect(prompt).toContain(
      "[media attached: /tmp/media-store/real-image.png (image/png) | https://example.com/real-image.png]",
    );
    expect(prompt).toContain(describedBody);
  });

  it("adds archive handling guidance when a zip attachment is present", () => {
    const sessionCtx = finalizeInboundContext({
      Body: "please unpack this and install it",
      BodyForAgent: "please unpack this and install it",
      From: "+1001",
      To: "+2000",
      MediaPath: "/tmp/media-store/bundle.zip",
      MediaUrl: "https://example.com/bundle.zip",
      MediaType: "application/zip",
    });
    const promptBodies = buildReplyPromptBodies({
      ctx: sessionCtx,
      sessionCtx,
      effectiveBaseBody: sessionCtx.BodyForAgent,
      prefixedBody: sessionCtx.BodyForAgent,
    });

    expect(promptBodies.archiveReplyHint).toContain(
      "treat its staged local path as actionable input",
    );
    expect(promptBodies.fileWorkHint).toContain(
      "Treat attached files and their staged local paths as primary task inputs",
    );
    expect(promptBodies.attachmentScopeHint).toContain(
      "Only the files listed in the current attachment note for this turn",
    );
    expect(promptBodies.currentAttachmentFocusHint).toContain(
      'resolve references like "this", "this file", "this output", "这个", "这个文件", and "这个输出" against the current turn attachment set first',
    );
    expect(promptBodies.prefixedCommandBody).toContain(
      "[archive ready: /tmp/media-store/bundle.zip (application/zip) | local path available for unpack/install]",
    );
    expect(promptBodies.prefixedCommandBody).toContain(
      "unpack it into the workspace when needed, then analyze, install, run",
    );
  });

  it("adds direct file-work guidance for document attachments", () => {
    const sessionCtx = finalizeInboundContext({
      Body: "read this document and summarize the key actions",
      BodyForAgent: "read this document and summarize the key actions",
      From: "+1001",
      To: "+2000",
      MediaPath: "/tmp/media-store/brief.pdf",
      MediaUrl: "https://example.com/brief.pdf",
      MediaType: "application/pdf",
    });
    const promptBodies = buildReplyPromptBodies({
      ctx: sessionCtx,
      sessionCtx,
      effectiveBaseBody: sessionCtx.BodyForAgent,
      prefixedBody: sessionCtx.BodyForAgent,
    });

    expect(promptBodies.fileWorkHint).toContain(
      "Prefer inspecting or reading the actual uploaded files first",
    );
    expect(promptBodies.attachmentScopeHint).toContain(
      "Do not automatically inspect older uploaded files",
    );
    expect(promptBodies.currentAttachmentFocusHint).toContain(
      "Do not summarize prior assistant outputs when the current turn attachment set is present",
    );
    expect(promptBodies.archiveReplyHint).toBeUndefined();
    expect(promptBodies.prefixedCommandBody).toContain(
      "[media attached: /tmp/media-store/brief.pdf (application/pdf) | https://example.com/brief.pdf]",
    );
    expect(promptBodies.prefixedCommandBody).toContain(
      "extract the relevant sections, tables, or structure you need",
    );
  });
});
