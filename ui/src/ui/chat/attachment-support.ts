export type SupportedChatAttachmentKind = "image" | "audio" | "video" | "document";

const SUPPORTED_CHAT_ATTACHMENT_MIMES = new Set([
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
]);

const SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS = new Set([
  ".csv",
  ".docx",
  ".html",
  ".json",
  ".md",
  ".pdf",
  ".pptx",
  ".txt",
  ".xlsx",
  ".zip",
]);

export const CHAT_ATTACHMENT_ACCEPT = [
  "image/*",
  "audio/*",
  "video/*",
  ...SUPPORTED_CHAT_ATTACHMENT_MIMES,
  ...SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS,
].join(",");

function normalizeMimeType(mimeType: string | null | undefined): string | undefined {
  if (typeof mimeType !== "string") {
    return undefined;
  }
  const [raw] = mimeType.split(";");
  return raw?.trim().toLowerCase() || undefined;
}

function normalizeFileExtension(fileName: string | null | undefined): string | undefined {
  if (typeof fileName !== "string") {
    return undefined;
  }
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) {
    return undefined;
  }
  return fileName.slice(dotIndex).trim().toLowerCase() || undefined;
}

export function resolveSupportedChatAttachmentKind(params: {
  mimeType?: string | null;
  fileName?: string | null;
}): SupportedChatAttachmentKind | undefined {
  const mimeType = normalizeMimeType(params.mimeType);
  if (mimeType?.startsWith("image/")) {
    return "image";
  }
  if (mimeType?.startsWith("audio/")) {
    return "audio";
  }
  if (mimeType?.startsWith("video/")) {
    return "video";
  }
  if (mimeType && SUPPORTED_CHAT_ATTACHMENT_MIMES.has(mimeType)) {
    return "document";
  }

  const extension = normalizeFileExtension(params.fileName);
  if (extension && SUPPORTED_CHAT_ATTACHMENT_EXTENSIONS.has(extension)) {
    return "document";
  }
  return undefined;
}

export function isSupportedChatAttachmentMimeType(
  mimeType: string | null | undefined,
  fileName?: string | null,
): boolean {
  return (
    resolveSupportedChatAttachmentKind({
      mimeType,
      fileName,
    }) !== undefined
  );
}
