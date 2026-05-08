import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { parseAgentSessionKey } from "../sessions/session-key-utils.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { resolveUserPath } from "../utils.js";
import { detectMime, extensionForMime } from "./mime.js";
import { MEDIA_MAX_BYTES, saveMediaBuffer, type SavedMedia } from "./store.js";

export type GeneratedOutputKind = "image" | "video" | "music" | "file";

export type SaveGeneratedOutputParams = {
  cfg: OpenClawConfig;
  buffer: Buffer;
  mimeType?: string;
  fallbackSubdir: string;
  maxBytes?: number;
  filenameHint?: string;
  preferFilenameExtension?: boolean;
  kind: GeneratedOutputKind;
  agentId?: string;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  model?: string;
  prompt?: string;
};

const KIND_DIRS: Record<GeneratedOutputKind, string> = {
  image: "images",
  video: "videos",
  music: "music",
  file: "files",
};

function sanitizeSegment(value: string | undefined, fallback: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return fallback;
  }
  return (
    normalized
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || fallback
  );
}

function sanitizeFilenameStem(value: string | undefined, fallback: string): string {
  const normalized = normalizeOptionalString(value);
  const parsed = normalized ? path.parse(normalized).name : "";
  return sanitizeSegment(parsed, fallback);
}

function resolveGeneratedOutputRoot(cfg: OpenClawConfig): string | undefined {
  const raw = normalizeOptionalString(cfg.tools?.media?.generatedOutputRoot);
  return raw ? resolveUserPath(raw) : undefined;
}

function resolveGeneratedOutputContext(params: SaveGeneratedOutputParams) {
  const parsed = parseAgentSessionKey(params.sessionKey);
  return {
    agentId: sanitizeSegment(params.agentId ?? parsed?.agentId, "unknown-agent"),
    sessionId: sanitizeSegment(params.sessionId ?? parsed?.rest, "unknown-session"),
  };
}

async function appendManifest(params: {
  outputDir: string;
  entry: Record<string, unknown>;
}): Promise<void> {
  await fs.appendFile(
    path.join(params.outputDir, "manifest.jsonl"),
    `${JSON.stringify(params.entry)}\n`,
    { mode: 0o600 },
  );
}

async function writeWithCollisionSuffix(params: {
  dir: string;
  stem: string;
  ext: string;
  buffer: Buffer;
}): Promise<{ id: string; filePath: string }> {
  for (let index = 0; index < 10_000; index += 1) {
    const suffix = index === 0 ? "" : ` (${index})`;
    const id = `${params.stem}${suffix}${params.ext}`;
    const filePath = path.join(params.dir, id);
    try {
      await fs.writeFile(filePath, params.buffer, { mode: 0o644, flag: "wx" });
      return { id, filePath };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Unable to allocate generated ${params.ext || "file"} output filename`);
}

export async function saveGeneratedOutput(params: SaveGeneratedOutputParams): Promise<SavedMedia> {
  const root = resolveGeneratedOutputRoot(params.cfg);
  if (!root) {
    return saveMediaBuffer(
      params.buffer,
      params.mimeType,
      params.fallbackSubdir,
      params.maxBytes,
      params.filenameHint,
    );
  }

  const maxBytes = params.maxBytes ?? MEDIA_MAX_BYTES;
  if (params.buffer.byteLength > maxBytes) {
    throw new Error(
      `Generated ${params.kind} exceeds ${(maxBytes / (1024 * 1024)).toFixed(0)}MB limit`,
    );
  }

  const now = new Date();
  const { agentId, sessionId } = resolveGeneratedOutputContext(params);
  const month = now.toISOString().slice(0, 7);
  const outputDir = path.join(root, agentId, month);
  const kindDir = path.join(outputDir, KIND_DIRS[params.kind]);
  await fs.mkdir(kindDir, { recursive: true, mode: 0o700 });

  const detectedMime =
    (await detectMime({ buffer: params.buffer, headerMime: params.mimeType })) ?? params.mimeType;
  const filenameExt = path.extname(params.filenameHint ?? "");
  const detectedExt = extensionForMime(normalizeOptionalString(detectedMime?.split(";")[0]));
  const ext =
    params.preferFilenameExtension && filenameExt ? filenameExt : detectedExt || filenameExt || "";
  const stem = sanitizeFilenameStem(params.filenameHint, params.kind);
  const { id, filePath } = await writeWithCollisionSuffix({
    dir: kindDir,
    stem,
    ext,
    buffer: params.buffer,
  });

  await appendManifest({
    outputDir,
    entry: {
      time: now.toISOString(),
      agentId,
      sessionId,
      kind: params.kind,
      path: filePath,
      mimeType: detectedMime,
      size: params.buffer.byteLength,
      provider: params.provider,
      model: params.model,
      prompt: params.prompt,
    },
  });

  return {
    id,
    path: filePath,
    size: params.buffer.byteLength,
    contentType: detectedMime,
  };
}
