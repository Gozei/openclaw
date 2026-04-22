import { normalizeLowercaseStringOrEmpty } from "../../shared/string-coerce.js";
import { buildInboundMediaNote } from "../media-note.js";
import type { MsgContext, TemplateContext } from "../templating.js";
import { appendUntrustedContext } from "./untrusted-context.js";

export const REPLY_MEDIA_HINT =
  "To send an image back, prefer the message tool (media/path/filePath). If you must inline, use MEDIA:https://example.com/image.jpg (spaces ok, quote if needed) or a safe relative path like MEDIA:./image.jpg. Absolute and ~ paths only work when they stay inside your allowed file-read boundary; host file:// URLs are blocked. Keep caption in the text body.";
export const REPLY_CURRENT_ATTACHMENT_SCOPE_HINT =
  "Only the files listed in the current attachment note for this turn are newly uploaded inputs for this request. Do not automatically inspect older uploaded files, prior-turn attachments, or unrelated workspace files unless the user explicitly asks for them or the current file directly points to them.";
export const REPLY_CURRENT_ATTACHMENT_FOCUS_HINT_PREFIX =
  'When the current turn includes uploaded attachments, resolve references like "this", "this file", "this output", "这个", "这个文件", and "这个输出" against the current turn attachment set first. Do not default those references to prior assistant outputs, earlier uploaded files, or historical workspace artifacts.';
export const REPLY_FILE_WORK_HINT =
  "Treat attached files and their staged local paths as primary task inputs, not just summaries. Prefer inspecting or reading the actual uploaded files first. For documents, spreadsheets, slides, PDFs, text, CSV, JSON, HTML, and similar files, extract the relevant sections, tables, or structure you need, then continue the requested analysis or downstream work from those file contents.";
export const REPLY_ARCHIVE_HINT =
  "When an attached zip archive is present, treat its staged local path as actionable input instead of a passive summary. Inspect the archive path first, unpack it into the workspace when needed, then analyze, install, run, or continue the requested work from the unpacked contents.";

function isActionableFileMime(type: string | undefined): boolean {
  const normalized = normalizeLowercaseStringOrEmpty(type);
  if (!normalized) {
    return false;
  }
  if (
    normalized.startsWith("image/") ||
    normalized.startsWith("audio/") ||
    normalized.startsWith("video/")
  ) {
    return false;
  }
  return (
    normalized.startsWith("text/") ||
    normalized === "application/pdf" ||
    normalized === "application/json" ||
    normalized === "application/zip" ||
    normalized === "application/x-zip-compressed" ||
    normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    normalized === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    normalized === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );
}

function hasActionableFileAttachment(ctx: MsgContext): boolean {
  if (Array.isArray(ctx.MediaTypes)) {
    return ctx.MediaTypes.some((entry) => isActionableFileMime(entry));
  }
  return isActionableFileMime(ctx.MediaType);
}

function hasZipAttachment(ctx: MsgContext): boolean {
  if (Array.isArray(ctx.MediaTypes)) {
    return ctx.MediaTypes.some((entry) => {
      const normalized = normalizeLowercaseStringOrEmpty(entry);
      return normalized === "application/zip" || normalized === "application/x-zip-compressed";
    });
  }
  const normalized = normalizeLowercaseStringOrEmpty(ctx.MediaType);
  return normalized === "application/zip" || normalized === "application/x-zip-compressed";
}

function resolveCurrentAttachmentCount(ctx: MsgContext): number {
  if (Array.isArray(ctx.MediaPaths) && ctx.MediaPaths.length > 0) {
    return ctx.MediaPaths.length;
  }
  return ctx.MediaPath ? 1 : 0;
}

function buildCurrentAttachmentFocusHint(ctx: MsgContext): string | undefined {
  const attachmentCount = resolveCurrentAttachmentCount(ctx);
  if (attachmentCount <= 0) {
    return undefined;
  }
  const countHint =
    attachmentCount === 1
      ? "This turn has exactly one uploaded attachment, so answer about that file unless the user explicitly names another file."
      : `This turn has ${attachmentCount} uploaded attachments, so stay within that current attachment set unless the user explicitly names an earlier file.`;
  return `${REPLY_CURRENT_ATTACHMENT_FOCUS_HINT_PREFIX} ${countHint} Do not summarize prior assistant outputs when the current turn attachment set is present unless the user explicitly asks for that earlier output.`;
}

export function buildReplyPromptBodies(params: {
  ctx: MsgContext;
  sessionCtx: TemplateContext;
  effectiveBaseBody: string;
  prefixedBody: string;
  threadContextNote?: string;
  systemEventBlocks?: string[];
}): {
  mediaNote?: string;
  mediaReplyHint?: string;
  attachmentScopeHint?: string;
  currentAttachmentFocusHint?: string;
  fileWorkHint?: string;
  archiveReplyHint?: string;
  prefixedCommandBody: string;
  queuedBody: string;
} {
  const combinedEventsBlock = (params.systemEventBlocks ?? []).filter(Boolean).join("\n");
  const prependEvents = (body: string) =>
    combinedEventsBlock ? `${combinedEventsBlock}\n\n${body}` : body;
  const bodyWithEvents = prependEvents(params.effectiveBaseBody);
  const prefixedBodyWithEvents = appendUntrustedContext(
    prependEvents(params.prefixedBody),
    params.sessionCtx.UntrustedContext,
  );
  const prefixedBody = [params.threadContextNote, prefixedBodyWithEvents]
    .filter(Boolean)
    .join("\n\n");
  const queueBodyBase = [params.threadContextNote, bodyWithEvents].filter(Boolean).join("\n\n");
  const mediaNote = buildInboundMediaNote(params.ctx);
  const mediaReplyHint = mediaNote ? REPLY_MEDIA_HINT : undefined;
  const attachmentScopeHint = mediaNote ? REPLY_CURRENT_ATTACHMENT_SCOPE_HINT : undefined;
  const currentAttachmentFocusHint = mediaNote
    ? buildCurrentAttachmentFocusHint(params.ctx)
    : undefined;
  const fileWorkHint =
    mediaNote && hasActionableFileAttachment(params.ctx) ? REPLY_FILE_WORK_HINT : undefined;
  const archiveReplyHint =
    mediaNote && hasZipAttachment(params.ctx) ? REPLY_ARCHIVE_HINT : undefined;
  const queuedBody = mediaNote
    ? [
        mediaNote,
        mediaReplyHint,
        attachmentScopeHint,
        currentAttachmentFocusHint,
        fileWorkHint,
        archiveReplyHint,
        queueBodyBase,
      ]
        .filter(Boolean)
        .join("\n")
        .trim()
    : queueBodyBase;
  const prefixedCommandBody = mediaNote
    ? [
        mediaNote,
        mediaReplyHint,
        attachmentScopeHint,
        currentAttachmentFocusHint,
        fileWorkHint,
        archiveReplyHint,
        prefixedBody,
      ]
        .filter(Boolean)
        .join("\n")
        .trim()
    : prefixedBody;
  return {
    mediaNote,
    mediaReplyHint,
    attachmentScopeHint,
    currentAttachmentFocusHint,
    fileWorkHint,
    archiveReplyHint,
    prefixedCommandBody,
    queuedBody,
  };
}
