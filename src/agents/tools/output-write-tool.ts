import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { saveGeneratedOutput } from "../../media/generated-output-store.js";
import { type AnyAgentTool, ToolInputError, readStringParam, textResult } from "./common.js";

type OutputWriteToolOptions = {
  config?: OpenClawConfig;
  agentId?: string;
  agentSessionKey?: string;
  sessionId?: string;
};

const OutputWriteToolSchema = Type.Object(
  {
    filename: Type.String({
      description:
        "Desired output filename, including extension. Directories are ignored; OpenClaw stores the file under the configured output root grouped by agent, month, and file kind.",
    }),
    content: Type.String({
      description:
        "File content. Defaults to UTF-8 text. Use encoding='base64' when writing binary bytes.",
    }),
    encoding: Type.Optional(
      Type.Union([Type.Literal("utf8"), Type.Literal("base64")], {
        description: "Content encoding. Defaults to utf8.",
      }),
    ),
    mimeType: Type.Optional(
      Type.String({
        description: "Optional MIME type hint, such as text/x-python or application/json.",
      }),
    ),
  },
  { additionalProperties: false },
);

function decodeContent(content: string, encoding: string | undefined): Buffer {
  if (!encoding || encoding === "utf8") {
    return Buffer.from(content, "utf8");
  }
  if (encoding !== "base64") {
    throw new ToolInputError("encoding must be utf8 or base64");
  }
  const normalized = content.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new ToolInputError("content must be valid base64 when encoding is base64");
  }
  return Buffer.from(normalized, "base64");
}

export function createOutputWriteTool(options: OutputWriteToolOptions = {}): AnyAgentTool {
  return {
    name: "output_write",
    label: "Output Write",
    description:
      "Write a user-facing output file to OpenClaw's configured generated output root, grouped by agent, month, and file kind. Use this for files the user asked you to create, export, or save; use write/edit/apply_patch only for modifying the workspace.",
    parameters: OutputWriteToolSchema,
    displaySummary: "Write output file",
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const filename = readStringParam(params, "filename", {
        required: true,
        label: "filename",
      });
      const content = readStringParam(params, "content", {
        required: true,
        label: "content",
        allowEmpty: true,
        trim: false,
      });
      const encoding = readStringParam(params, "encoding");
      const mimeType = readStringParam(params, "mimeType");
      const buffer = decodeContent(content, encoding);
      const saved = await saveGeneratedOutput({
        cfg: options.config ?? {},
        buffer,
        mimeType,
        filenameHint: filename,
        preferFilenameExtension: true,
        kind: "file",
        fallbackSubdir: "tool-file-output",
        agentId: options.agentId,
        sessionId: options.sessionId,
        sessionKey: options.agentSessionKey,
      });

      return textResult(`Wrote output file to ${saved.path}\nMEDIA:${saved.path}`, {
        path: saved.path,
        filename,
        size: saved.size,
        contentType: saved.contentType,
        media: {
          mediaUrl: saved.path,
        },
      });
    },
  };
}
