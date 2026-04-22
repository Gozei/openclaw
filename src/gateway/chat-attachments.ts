import { formatErrorMessage } from "../infra/errors.js";
import { estimateBase64DecodedBytes } from "../media/base64.js";
import { maxBytesForKind, mediaKindFromMime, type MediaKind } from "../media/constants.js";
import { isOfficeDocumentMime } from "../media/office-extract.js";
import type { PromptImageOrderEntry } from "../media/prompt-image-order.js";
import { sniffMimeFromBase64 } from "../media/sniff-mime-from-base64.js";
import { deleteMediaBuffer, saveMediaBuffer } from "../media/store.js";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalLowercaseString,
} from "../shared/string-coerce.js";
import { DEFAULT_GATEWAY_ATTACHMENT_MAX_BYTES } from "./control-ui-contract.js";

export type ChatAttachment = {
  type?: string;
  mimeType?: string;
  fileName?: string;
  content?: unknown;
};

export type ChatImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

/**
 * Metadata for an attachment that was offloaded to the media store.
 *
 * Included in ParsedMessageWithImages.offloadedRefs so that callers can
 * persist structured media metadata for transcripts. Without this, consumers
 * that derive MediaPath/MediaPaths from the `images` array (e.g.
 * persistChatSendImages and buildChatSendTranscriptMessage in chat.ts) would
 * silently omit all large attachments that were offloaded to disk.
 */
export type OffloadedRef = {
  /** Opaque media URI injected into the message, e.g. "media://inbound/<id>" */
  mediaRef: string;
  /** The raw media ID from SavedMedia.id, usable with resolveMediaBufferPath */
  id: string;
  /** Absolute filesystem path returned by saveMediaBuffer — used for transcript MediaPath */
  path: string;
  /** MIME type of the offloaded attachment */
  mimeType: string;
  /** The label / filename of the original attachment */
  label: string;
};

export type SavedAttachmentRef = {
  id: string;
  path: string;
  mimeType: string;
  label: string;
  kind: MediaKind;
};

export type ChatAttachmentOrderEntry = "inline-image" | "saved";

export type ParsedMessageWithImages = {
  message: string;
  /** Small attachments (≤ OFFLOAD_THRESHOLD_BYTES) passed inline to the model */
  images: ChatImageContent[];
  /** Original accepted attachment order after inline/offloaded split. */
  imageOrder: PromptImageOrderEntry[];
  /**
   * Large attachments (> OFFLOAD_THRESHOLD_BYTES) that were offloaded to the
   * media store. Each entry corresponds to a `[media attached: media://inbound/<id>]`
   * marker appended to `message`.
   *
   * Callers MUST persist this list separately for transcript media metadata.
   * It is intentionally separate from `images` because downstream model calls
   * do not receive these as inline image blocks.
   *
   * ⚠️  Call sites (chat.ts, agent.ts, server-node-events.ts) MUST also pass
   * `supportsImages: modelSupportsImages(model)` so that text-only model runs
   * do not inject unresolvable media:// markers into prompt text.
   */
  offloadedRefs: OffloadedRef[];
  /** Attachments already materialized to the media store for MediaPath-based flows. */
  savedAttachments: SavedAttachmentRef[];
  /** Original accepted attachment order across inline images and already-saved attachments. */
  attachmentOrder: ChatAttachmentOrderEntry[];
};

type AttachmentLog = {
  info?: (message: string) => void;
  warn: (message: string) => void;
};

type NormalizedAttachment = {
  label: string;
  mime: string;
  base64: string;
};

type SavedMedia = {
  id: string;
  path?: string;
};

export function resolveGatewayAttachmentMaxBytes(cfg?: {
  gateway?: { attachments?: { maxBytes?: number } };
}): number {
  return typeof cfg?.gateway?.attachments?.maxBytes === "number"
    ? cfg.gateway.attachments.maxBytes
    : DEFAULT_GATEWAY_ATTACHMENT_MAX_BYTES;
}

const OFFLOAD_THRESHOLD_BYTES = 2_000_000;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  // bmp/tiff excluded from SUPPORTED_OFFLOAD_MIMES to avoid extension-loss
  // bug in store.ts; entries kept here for future extension support
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
};

// Module-level Set for O(1) lookup — not rebuilt on every attachment iteration.
//
// heic/heif are included only if store.ts's extensionForMime maps them to an
// extension. If it does not (same extension-loss risk as bmp/tiff), remove
// them from this set.
const SUPPORTED_OFFLOAD_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const UNSUPPORTED_ARCHIVE_MIMES = new Set([
  "application/gzip",
  "application/x-7z-compressed",
  "application/x-gzip",
  "application/x-rar-compressed",
  "application/x-zip-compressed",
]);

/**
 * Raised when the Gateway cannot persist an attachment to the media store.
 *
 * Distinct from ordinary input-validation errors so that Gateway handlers can
 * map it to a server-side 5xx status rather than a client 4xx.
 *
 * Example causes: ENOSPC, EPERM, unexpected saveMediaBuffer return shape.
 */
export class MediaOffloadError extends Error {
  readonly cause: unknown;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaOffloadError";
    this.cause = options?.cause;
  }
}

function normalizeMime(mime?: string): string | undefined {
  if (!mime) {
    return undefined;
  }
  const cleaned = normalizeOptionalLowercaseString(mime.split(";")[0]);
  return cleaned || undefined;
}

function isArchiveMime(mime?: string): boolean {
  return typeof mime === "string" && (UNSUPPORTED_ARCHIVE_MIMES.has(mime) || mime.endsWith("+zip"));
}

function resolvePreferredAttachmentMime(params: {
  providedMime?: string;
  sniffedMime?: string;
}): string | undefined {
  const { providedMime, sniffedMime } = params;
  if (sniffedMime === "application/zip" && providedMime && isOfficeDocumentMime(providedMime)) {
    return providedMime;
  }
  return sniffedMime ?? providedMime;
}

function formatAttachmentMimeDecision(params: {
  label: string;
  providedMime?: string;
  sniffedMime?: string;
  finalMime?: string;
  finalKind?: MediaKind;
  sizeBytes: number;
}): string {
  return [
    `label=${params.label}`,
    `provided=${params.providedMime ?? "unknown"}`,
    `sniffed=${params.sniffedMime ?? "unknown"}`,
    `final=${params.finalMime ?? "unknown"}`,
    `kind=${params.finalKind ?? "unknown"}`,
    `bytes=${params.sizeBytes}`,
  ].join(" ");
}

function isValidBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) {
    return false;
  }
  // A full O(n) regex scan is safe: no overlapping quantifiers, fails linearly.
  // Prevents adversarial payloads padded with megabytes of whitespace from
  // bypassing length thresholds.
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/**
 * Confirms that the decoded buffer produced by Buffer.from(b64, 'base64')
 * matches the pre-decode size estimate.
 *
 * Node's Buffer.from silently drops invalid base64 characters rather than
 * throwing. A material size discrepancy means the source string contained
 * embedded garbage that was silently stripped, which would produce a corrupted
 * file on disk. ±3 bytes of slack accounts for base64 padding rounding.
 *
 * IMPORTANT: this is an input-validation check (4xx client error).
 * It MUST be called OUTSIDE the MediaOffloadError try/catch so that
 * corrupt-input errors are not misclassified as 5xx server errors.
 */
function verifyDecodedSize(buffer: Buffer, estimatedBytes: number, label: string): void {
  if (Math.abs(buffer.byteLength - estimatedBytes) > 3) {
    throw new Error(
      `attachment ${label}: base64 contains invalid characters ` +
        `(expected ~${estimatedBytes} bytes decoded, got ${buffer.byteLength})`,
    );
  }
}

function ensureExtension(label: string, mime: string): string {
  if (/\.[a-zA-Z0-9]+$/.test(label)) {
    return label;
  }
  const ext = MIME_TO_EXT[normalizeLowercaseStringOrEmpty(mime)] ?? "";
  return ext ? `${label}${ext}` : label;
}

async function saveAttachmentToMediaStore(params: {
  label: string;
  mimeType: string;
  base64: string;
  maxBytes: number;
}): Promise<SavedAttachmentRef> {
  const buffer = Buffer.from(params.base64, "base64");
  verifyDecodedSize(buffer, estimateBase64DecodedBytes(params.base64), params.label);
  try {
    const rawResult = await saveMediaBuffer(
      buffer,
      params.mimeType,
      "inbound",
      Math.min(params.maxBytes, maxBytesForKind(mediaKindFromMime(params.mimeType) ?? "document")),
      ensureExtension(params.label, params.mimeType),
    );
    const savedMedia = assertSavedMedia(rawResult, params.label);
    const kind = mediaKindFromMime(params.mimeType);
    if (!kind || !savedMedia.path) {
      throw new Error(`attachment ${params.label}: unsupported persisted mime ${params.mimeType}`);
    }
    return {
      id: savedMedia.id,
      path: savedMedia.path,
      mimeType: params.mimeType,
      label: params.label,
      kind,
    };
  } catch (err) {
    const errorMessage = formatErrorMessage(err);
    throw new MediaOffloadError(
      `[Gateway Error] Failed to save intercepted media to disk: ${errorMessage}`,
      { cause: err },
    );
  }
}

/**
 * Type guard for the return value of saveMediaBuffer.
 *
 * Also validates that the returned ID:
 * - is a non-empty string
 * - contains no path separators (/ or \) or null bytes
 *
 * Catching a bad shape here produces a cleaner error than a cryptic failure
 * deeper in the stack, and is treated as a 5xx infrastructure error.
 */
function assertSavedMedia(value: unknown, label: string): SavedMedia {
  if (
    value !== null &&
    typeof value === "object" &&
    "id" in value &&
    typeof (value as Record<string, unknown>).id === "string"
  ) {
    const id = (value as Record<string, unknown>).id as string;
    if (id.length === 0) {
      throw new Error(`attachment ${label}: saveMediaBuffer returned an empty media ID`);
    }
    if (id.includes("/") || id.includes("\\") || id.includes("\0")) {
      throw new Error(
        `attachment ${label}: saveMediaBuffer returned an unsafe media ID ` +
          `(contains path separator or null byte)`,
      );
    }
    return value as SavedMedia;
  }
  throw new Error(`attachment ${label}: saveMediaBuffer returned an unexpected shape`);
}

function normalizeAttachment(
  att: ChatAttachment,
  idx: number,
  opts: { stripDataUrlPrefix: boolean; requireImageMime: boolean },
): NormalizedAttachment {
  const mime = att.mimeType ?? "";
  const content = att.content;
  const label = att.fileName || att.type || `attachment-${idx + 1}`;

  if (typeof content !== "string") {
    throw new Error(`attachment ${label}: content must be base64 string`);
  }
  if (opts.requireImageMime && !mime.startsWith("image/")) {
    throw new Error(`attachment ${label}: only image/* supported`);
  }

  let base64 = content.trim();
  if (opts.stripDataUrlPrefix) {
    const dataUrlMatch = /^data:[^;]+;base64,(.*)$/.exec(base64);
    if (dataUrlMatch) {
      base64 = dataUrlMatch[1];
    }
  }
  return { label, mime, base64 };
}

function validateAttachmentBase64OrThrow(
  normalized: NormalizedAttachment,
  opts: { maxBytes: number },
): number {
  if (!isValidBase64(normalized.base64)) {
    throw new Error(`attachment ${normalized.label}: invalid base64 content`);
  }
  const sizeBytes = estimateBase64DecodedBytes(normalized.base64);
  if (sizeBytes <= 0 || sizeBytes > opts.maxBytes) {
    throw new Error(
      `attachment ${normalized.label}: exceeds size limit (${sizeBytes} > ${opts.maxBytes} bytes)`,
    );
  }
  return sizeBytes;
}

/**
 * Parse attachments and extract images as structured content blocks.
 * Returns the message text, inline image blocks, and offloaded media refs.
 *
 * ## Offload behaviour
 * Attachments whose decoded size exceeds OFFLOAD_THRESHOLD_BYTES are saved to
 * disk via saveMediaBuffer and replaced with an opaque `media://inbound/<id>`
 * URI appended to the message. The agent resolves these URIs via
 * resolveMediaBufferPath before passing them to the model.
 *
 * ## Transcript metadata
 * Callers MUST use `result.offloadedRefs` to persist structured media metadata
 * for transcripts. These refs are intentionally excluded from `result.images`
 * because they are not passed inline to the model.
 *
 * ## Text-only model runs
 * Pass `supportsImages: false` for text-only model runs so that no media://
 * markers are injected into prompt text.
 *
 * ⚠️  Call sites in chat.ts, agent.ts, and server-node-events.ts MUST be
 * updated to pass `supportsImages: modelSupportsImages(model)`. Until they do,
 * text-only model runs receive unresolvable media:// markers in their prompt.
 *
 * ## Cleanup on failure
 * On any parse failure after files have already been offloaded, best-effort
 * cleanup is performed before rethrowing so that malformed requests do not
 * accumulate orphaned files on disk ahead of the periodic TTL sweep.
 *
 * ## Known ordering limitation
 * In mixed large/small batches, the model receives images in a different order
 * than the original attachment list because detectAndLoadPromptImages
 * initialises from existingImages first, then appends prompt-detected refs.
 * A future refactor should unify all image references into a single ordered list.
 *
 * @throws {MediaOffloadError} Infrastructure failure saving to media store → 5xx.
 * @throws {Error} Input validation failure → 4xx.
 */
export async function parseMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number; log?: AttachmentLog; supportsImages?: boolean },
): Promise<ParsedMessageWithImages> {
  const maxBytes = opts?.maxBytes ?? DEFAULT_GATEWAY_ATTACHMENT_MAX_BYTES;
  const log = opts?.log;

  if (!attachments || attachments.length === 0) {
    return {
      message,
      images: [],
      imageOrder: [],
      offloadedRefs: [],
      savedAttachments: [],
      attachmentOrder: [],
    };
  }

  const images: ChatImageContent[] = [];
  const imageOrder: PromptImageOrderEntry[] = [];
  const offloadedRefs: OffloadedRef[] = [];
  const savedAttachments: SavedAttachmentRef[] = [];
  const attachmentOrder: ChatAttachmentOrderEntry[] = [];
  let updatedMessage = message;

  // Track IDs of files saved during this request for cleanup if a later
  // attachment fails validation and the entire parse is aborted.
  const savedMediaIds: string[] = [];

  try {
    for (const [idx, att] of attachments.entries()) {
      if (!att) {
        continue;
      }

      const normalized = normalizeAttachment(att, idx, {
        stripDataUrlPrefix: true,
        requireImageMime: false,
      });

      const { base64: b64, label, mime } = normalized;

      if (!isValidBase64(b64)) {
        throw new Error(`attachment ${label}: invalid base64 content`);
      }

      const sizeBytes = estimateBase64DecodedBytes(b64);
      if (sizeBytes <= 0) {
        log?.warn(`attachment ${label}: estimated size is zero, dropping`);
        continue;
      }

      if (sizeBytes > maxBytes) {
        throw new Error(
          `attachment ${label}: exceeds size limit (${sizeBytes} > ${maxBytes} bytes)`,
        );
      }

      const providedMime = normalizeMime(mime);
      if (providedMime && isArchiveMime(providedMime)) {
        log?.warn(`attachment ${label}: unsupported attachment type (${providedMime})`);
        continue;
      }
      const sniffedMime = normalizeMime(await sniffMimeFromBase64(b64));
      const finalMime =
        resolvePreferredAttachmentMime({
          providedMime,
          sniffedMime,
        }) ??
        normalizeMime(mime) ??
        mime;
      const finalKind = mediaKindFromMime(finalMime);
      log?.info?.(
        `attachment ${label}: parsed ${formatAttachmentMimeDecision({
          label,
          providedMime,
          sniffedMime,
          finalMime,
          finalKind,
          sizeBytes,
        })}`,
      );

      if (!finalKind || isArchiveMime(finalMime)) {
        log?.warn(`attachment ${label}: unsupported attachment type (${finalMime || "unknown"})`);
        continue;
      }
      if (
        sniffedMime &&
        providedMime &&
        sniffedMime !== providedMime &&
        finalMime === sniffedMime
      ) {
        log?.warn(
          `attachment ${label}: mime mismatch (${providedMime} -> ${sniffedMime}), using sniffed`,
        );
      }

      let isOffloaded = false;
      const shouldInlineImage = finalKind === "image" && opts?.supportsImages !== false;

      if (!shouldInlineImage) {
        const savedAttachment = await saveAttachmentToMediaStore({
          label,
          mimeType: finalMime,
          base64: b64,
          maxBytes,
        });
        log?.info?.(
          `attachment ${label}: saved mime=${savedAttachment.mimeType} kind=${savedAttachment.kind} path=${savedAttachment.path}`,
        );
        savedMediaIds.push(savedAttachment.id);
        savedAttachments.push(savedAttachment);
        attachmentOrder.push("saved");
        continue;
      }

      if (sizeBytes > OFFLOAD_THRESHOLD_BYTES) {
        const isSupportedForOffload = SUPPORTED_OFFLOAD_MIMES.has(finalMime);

        if (!isSupportedForOffload) {
          // Passing this inline would reintroduce the OOM risk this PR prevents.
          throw new Error(
            `attachment ${label}: format ${finalMime} is too large to pass inline ` +
              `(${sizeBytes} > ${OFFLOAD_THRESHOLD_BYTES} bytes) and cannot be offloaded. ` +
              `Please convert to JPEG, PNG, WEBP, GIF, HEIC, or HEIF.`,
          );
        }

        // Decode and run input-validation BEFORE the MediaOffloadError try/catch.
        // verifyDecodedSize is a 4xx client error and must not be wrapped as a
        // 5xx MediaOffloadError.
        const buffer = Buffer.from(b64, "base64");
        verifyDecodedSize(buffer, sizeBytes, label);

        // Only the storage operation is wrapped so callers can distinguish
        // infrastructure failures (5xx) from input errors (4xx).
        try {
          const labelWithExt = ensureExtension(label, finalMime);

          const rawResult = await saveMediaBuffer(
            buffer,
            finalMime,
            "inbound",
            maxBytes,
            labelWithExt,
          );

          const savedMedia = assertSavedMedia(rawResult, label);

          // Track for cleanup if a subsequent attachment fails.
          savedMediaIds.push(savedMedia.id);

          // Opaque URI — compatible with workspaceOnly sandboxes and decouples
          // the Gateway from the agent's filesystem layout.
          const mediaRef = `media://inbound/${savedMedia.id}`;

          updatedMessage += `\n[media attached: ${mediaRef}]`;
          log?.info?.(`[Gateway] Intercepted large image payload. Saved: ${mediaRef}`);

          // Record for transcript metadata — separate from `images` because
          // these are not passed inline to the model.
          offloadedRefs.push({
            mediaRef,
            id: savedMedia.id,
            path: savedMedia.path ?? "",
            mimeType: finalMime,
            label,
          });
          savedAttachments.push({
            id: savedMedia.id,
            path: savedMedia.path ?? "",
            mimeType: finalMime,
            label,
            kind: "image",
          });
          log?.info?.(
            `attachment ${label}: offloaded mime=${finalMime} path=${savedMedia.path ?? ""} ref=${mediaRef}`,
          );
          imageOrder.push("offloaded");
          attachmentOrder.push("saved");

          isOffloaded = true;
        } catch (err) {
          const errorMessage = formatErrorMessage(err);
          throw new MediaOffloadError(
            `[Gateway Error] Failed to save intercepted media to disk: ${errorMessage}`,
            { cause: err },
          );
        }
      }

      if (isOffloaded) {
        continue;
      }

      images.push({ type: "image", data: b64, mimeType: finalMime });
      log?.info?.(`attachment ${label}: kept inline mime=${finalMime} bytes=${sizeBytes}`);
      imageOrder.push("inline");
      attachmentOrder.push("inline-image");
    }
  } catch (err) {
    // Best-effort cleanup before rethrowing.
    if (savedMediaIds.length > 0) {
      await Promise.allSettled(savedMediaIds.map((id) => deleteMediaBuffer(id, "inbound")));
    }
    throw err;
  }

  return {
    message: updatedMessage !== message ? updatedMessage.trimEnd() : message,
    images,
    imageOrder,
    offloadedRefs,
    savedAttachments,
    attachmentOrder,
  };
}

/**
 * @deprecated Use parseMessageWithAttachments instead.
 * This function converts images to markdown data URLs which Claude API cannot process as images.
 */
export function buildMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number },
): string {
  const maxBytes = opts?.maxBytes ?? 2_000_000;

  if (!attachments || attachments.length === 0) {
    return message;
  }

  const blocks: string[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }

    const normalized = normalizeAttachment(att, idx, {
      stripDataUrlPrefix: false,
      requireImageMime: true,
    });
    validateAttachmentBase64OrThrow(normalized, { maxBytes });

    const { base64, label, mime } = normalized;
    const safeLabel = label.replace(/\s+/g, "_");
    blocks.push(`![${safeLabel}](data:${mime};base64,${base64})`);
  }

  if (blocks.length === 0) {
    return message;
  }

  const separator = message.trim().length > 0 ? "\n\n" : "";
  return `${message}${separator}${blocks.join("\n\n")}`;
}
