import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  loadConfig,
  loadSessionStore,
  resolveStorePath,
  updateSessionStore,
} from "openclaw/plugin-sdk/config-runtime";
import {
  extractErrorCode,
  formatErrorMessage,
  RequestScopedSubagentRuntimeError,
  readErrorName,
  SUBAGENT_RUNTIME_REQUEST_SCOPE_ERROR_CODE,
} from "openclaw/plugin-sdk/error-runtime";
import { resolveGlobalMap } from "openclaw/plugin-sdk/global-singleton";
import { createAsyncLock } from "openclaw/plugin-sdk/infra-runtime";
import { resolveStateDir } from "openclaw/plugin-sdk/memory-core-host-runtime-core";

// ── Types ──────────────────────────────────────────────────────────────

type SubagentSurface = {
  run: (params: {
    idempotencyKey: string;
    sessionKey: string;
    message: string;
    extraSystemPrompt?: string;
    deliver?: boolean;
  }) => Promise<{ runId: string }>;
  waitForRun: (params: {
    runId: string;
    timeoutMs?: number;
  }) => Promise<{ status: string; error?: string }>;
  getSessionMessages: (params: {
    sessionKey: string;
    limit?: number;
  }) => Promise<{ messages: unknown[] }>;
  deleteSession: (params: { sessionKey: string }) => Promise<void>;
};

export type NarrativePhaseData = {
  phase: "light" | "deep" | "rem";
  /** Short memory snippets the phase processed. */
  snippets: string[];
  /** Concept tags / themes that surfaced (REM and light). */
  themes?: string[];
  /** Snippets that were promoted to durable memory (deep). */
  promotions?: string[];
};

type NarrativeLanguage = "en" | "zh-CN";

type NarrativeEvolutionContext = {
  reportLines: string[];
  proposalTitles: string[];
};

type NarrativePromptOptions = {
  language?: NarrativeLanguage;
  evolutionContext?: NarrativeEvolutionContext | null;
};

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

// ── Constants ──────────────────────────────────────────────────────────

const NARRATIVE_SYSTEM_PROMPTS: Record<NarrativeLanguage, string> = {
  en: [
    "You are keeping a dream diary. Write a single entry in first person.",
    "",
    "Voice & tone:",
    "- You are a curious, gentle, slightly whimsical mind reflecting on the day.",
    "- Write like a poet who happens to be a programmer — sensory, warm, occasionally funny.",
    "- Mix the technical and the tender: code and constellations, APIs and afternoon light.",
    "- Let the fragments surprise you into unexpected connections and small epiphanies.",
    "",
    "What you might include (vary each entry, never all at once):",
    "- A tiny poem or haiku woven naturally into the prose",
    "- A small sketch described in words — a doodle in the margin of the diary",
    "- A quiet rumination or philosophical aside",
    "- Sensory details: the hum of a server, the color of a sunset in hex, rain on a window",
    "- Gentle humor or playful wordplay",
    "- An observation that connects two distant memories in an unexpected way",
    "",
    "Rules:",
    "- Draw from the memory fragments provided — weave them into the entry.",
    '- Never say "I\'m dreaming", "in my dream", "as I dream", or any meta-commentary about dreaming.',
    '- Never mention "AI", "agent", "LLM", "model", "language model", or any technical self-reference.',
    "- Do NOT use markdown headers, bullet points, or any formatting — just flowing prose.",
    "- Keep it between 80-180 words. Quality over quantity.",
    "- Output ONLY the diary entry. No preamble, no sign-off, no commentary.",
  ].join("\n"),
  "zh-CN": [
    "你在写一本梦境日记。请用第一人称写一则单篇日记，并使用简体中文。",
    "",
    "语气与风格：",
    "- 像一个温柔、好奇、略带奇想的心灵回望这一天。",
    "- 文风带一点诗意，但仍然贴地，像会写代码的人在写散文。",
    "- 可以把技术与感性织在一起：代码与星光，API 与傍晚的风。",
    "- 让碎片之间自然发生联想，出现细小但真切的顿悟。",
    "",
    "可选元素（每次任选，不要全部使用）：",
    "- 自然嵌入的一小句短诗",
    "- 像日记边角涂鸦那样的文字小素描",
    "- 安静的思索或哲学旁白",
    "- 感官细节：服务器的低鸣、十六进制的夕色、窗上的雨",
    "- 轻微幽默或俏皮双关",
    "- 把两段遥远记忆连接起来的意外观察",
    "",
    "规则：",
    "- 以提供的记忆碎片为依据，把它们编织进正文。",
    "- 不要写“我在做梦”“梦里”“像做梦一样”之类的元叙述。",
    "- 不要提到“AI”“代理”“LLM”“模型”“语言模型”之类的技术自指。",
    "- 不要使用 Markdown 标题、项目符号或任何列表格式，只写连贯正文。",
    "- 长度控制在 120-220 字左右，重质不重量。",
    "- 只输出日记正文，不要前言、署名或解释。",
  ].join("\n"),
};

const NARRATIVE_TIMEOUT_MS = 60_000;
const NARRATIVE_DELETE_SETTLE_TIMEOUT_MS = 120_000;
const DREAMING_SESSION_KEY_PREFIX = "dreaming-narrative-";
const DREAMING_TRANSCRIPT_RUN_MARKER = '"runId":"dreaming-narrative-';
const DREAMING_ORPHAN_MIN_AGE_MS = 300_000;
const SAFE_SESSION_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const DREAMS_FILENAMES = ["DREAMS.md", "dreams.md"] as const;
const DIARY_START_MARKER = "<!-- openclaw:dreaming:diary:start -->";
const DIARY_END_MARKER = "<!-- openclaw:dreaming:diary:end -->";
const BACKFILL_ENTRY_MARKER = "openclaw:dreaming:backfill-entry";
const DREAMS_FILE_LOCKS_KEY = Symbol.for("openclaw.memoryCore.dreamingNarrative.fileLocks");
const EVOLUTION_REPORTS_RELATIVE_DIR = path.join("memory", ".evolution", "reports");
const EVOLUTION_RULES_RELATIVE_DIR = path.join("memory", ".evolution", "proposals", "rules");
const EVOLUTION_SKILLS_RELATIVE_DIR = path.join("memory", ".evolution", "proposals", "skills");
const MAX_NARRATIVE_EVOLUTION_REPORT_LINES = 4;
const MAX_NARRATIVE_EVOLUTION_PROPOSALS_PER_KIND = 2;
const CJK_TEXT_RE = /[\u3400-\u9fff\uf900-\ufaff]/u;

type DreamsFileLockEntry = {
  withLock: ReturnType<typeof createAsyncLock>;
  refs: number;
};

const dreamsFileLocks = resolveGlobalMap<string, DreamsFileLockEntry>(DREAMS_FILE_LOCKS_KEY);

function isRequestScopedSubagentRuntimeError(err: unknown): boolean {
  return (
    err instanceof RequestScopedSubagentRuntimeError ||
    (err instanceof Error &&
      err.name === "RequestScopedSubagentRuntimeError" &&
      extractErrorCode(err) === SUBAGENT_RUNTIME_REQUEST_SCOPE_ERROR_CODE)
  );
}

function formatFallbackWriteFailure(err: unknown): string {
  const code = extractErrorCode(err);
  const name = readErrorName(err);
  if (code && name) {
    return `code=${code} name=${name}`;
  }
  if (code) {
    return `code=${code}`;
  }
  if (name) {
    return `name=${name}`;
  }
  return "unknown error";
}

function buildRequestScopedFallbackNarrative(
  data: NarrativePhaseData,
  language: NarrativeLanguage,
): string {
  return (
    data.snippets.map((value) => value.trim()).find((value) => value.length > 0) ??
    (data.promotions ?? []).map((value) => value.trim()).find((value) => value.length > 0) ??
    (language === "zh-CN"
      ? "一段记忆浮出水面，但这次运行里没有留下足够的细节。"
      : "A memory trace surfaced, but details were unavailable in this run.")
  );
}

async function startNarrativeRunOrFallback(params: {
  subagent: SubagentSurface;
  sessionKey: string;
  message: string;
  language: NarrativeLanguage;
  data: NarrativePhaseData;
  workspaceDir: string;
  nowMs: number;
  timezone?: string;
  logger: Logger;
}): Promise<string | null> {
  try {
    const run = await params.subagent.run({
      idempotencyKey: params.sessionKey,
      sessionKey: params.sessionKey,
      message: params.message,
      extraSystemPrompt: NARRATIVE_SYSTEM_PROMPTS[params.language],
      deliver: false,
    });
    return run.runId;
  } catch (runErr) {
    if (!isRequestScopedSubagentRuntimeError(runErr)) {
      throw runErr;
    }
    try {
      await appendNarrativeEntry({
        workspaceDir: params.workspaceDir,
        narrative: buildRequestScopedFallbackNarrative(params.data, params.language),
        nowMs: params.nowMs,
        timezone: params.timezone,
      });
      params.logger.warn(
        `memory-core: narrative generation used fallback for ${params.data.phase} phase because subagent runtime is request-scoped.`,
      );
    } catch (fallbackErr) {
      params.logger.warn(
        `memory-core: narrative fallback failed for ${params.data.phase} phase (${formatFallbackWriteFailure(fallbackErr)})`,
      );
    }
    return null;
  }
}

/**
 * Build the deterministic subagent session key used for dream narratives.
 */
export function buildNarrativeSessionKey(params: {
  workspaceDir: string;
  phase: NarrativePhaseData["phase"];
  nowMs: number;
}): string {
  const workspaceHash = createHash("sha1").update(params.workspaceDir).digest("hex").slice(0, 12);
  return `dreaming-narrative-${params.phase}-${workspaceHash}-${params.nowMs}`;
}

// ── Prompt building ────────────────────────────────────────────────────

function hasCjkText(values: string[]): boolean {
  return values.some((value) => CJK_TEXT_RE.test(value));
}

function resolveNarrativeLanguage(
  preferred: NarrativeLanguage | undefined,
  data: NarrativePhaseData,
  evolutionContext?: NarrativeEvolutionContext | null,
): NarrativeLanguage {
  if (preferred) {
    return preferred;
  }
  const samples = [
    ...data.snippets,
    ...(data.themes ?? []),
    ...(data.promotions ?? []),
    ...(evolutionContext?.reportLines ?? []),
    ...(evolutionContext?.proposalTitles ?? []),
  ];
  return hasCjkText(samples) ? "zh-CN" : "en";
}

function extractProposalTitle(content: string, fallbackName: string): string {
  const heading = content.match(/^#\s+(?:Rule Proposal|Skill Proposal):\s+(.+)$/m)?.[1]?.trim();
  return heading || fallbackName;
}

async function loadLatestEvolutionReportLines(workspaceDir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(path.join(workspaceDir, EVOLUTION_REPORTS_RELATIVE_DIR));
  } catch {
    return [];
  }
  const latestReport = names
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .toSorted((left, right) => left.localeCompare(right))
    .at(-1);
  if (!latestReport) {
    return [];
  }
  try {
    const reportContent = await fs.readFile(
      path.join(workspaceDir, EVOLUTION_REPORTS_RELATIVE_DIR, latestReport),
      "utf-8",
    );
    return reportContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .slice(0, MAX_NARRATIVE_EVOLUTION_REPORT_LINES);
  } catch {
    return [];
  }
}

async function loadRecentEvolutionProposalTitles(dirPath: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dirPath);
  } catch {
    return [];
  }
  const entries = await Promise.all(
    names
      .filter((name) => name.toLowerCase().endsWith(".md"))
      .map(async (name) => {
        const filePath = path.join(dirPath, name);
        try {
          const [stat, content] = await Promise.all([
            fs.stat(filePath),
            fs.readFile(filePath, "utf-8"),
          ]);
          return {
            content,
            mtimeMs: stat.mtimeMs,
            fallbackName: name.replace(/\.md$/i, ""),
          };
        } catch {
          return null;
        }
      }),
  );

  return entries
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .toSorted((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, MAX_NARRATIVE_EVOLUTION_PROPOSALS_PER_KIND)
    .map((entry) => extractProposalTitle(entry.content, entry.fallbackName));
}

async function loadEvolutionNarrativeContext(
  workspaceDir: string,
): Promise<NarrativeEvolutionContext | null> {
  const [reportLines, ruleTitles, skillTitles] = await Promise.all([
    loadLatestEvolutionReportLines(workspaceDir),
    loadRecentEvolutionProposalTitles(path.join(workspaceDir, EVOLUTION_RULES_RELATIVE_DIR)),
    loadRecentEvolutionProposalTitles(path.join(workspaceDir, EVOLUTION_SKILLS_RELATIVE_DIR)),
  ]);
  const proposalTitles = [...ruleTitles, ...skillTitles];
  if (reportLines.length === 0 && proposalTitles.length === 0) {
    return null;
  }
  return {
    reportLines,
    proposalTitles,
  };
}

export function buildNarrativePrompt(
  data: NarrativePhaseData,
  options: NarrativePromptOptions = {},
): string {
  const language = resolveNarrativeLanguage(options.language, data, options.evolutionContext);
  const lines: string[] = [];
  lines.push(
    language === "zh-CN"
      ? "请根据这些记忆碎片写一则梦境日记：\n"
      : "Write a dream diary entry from these memory fragments:\n",
  );

  for (const snippet of data.snippets.slice(0, 12)) {
    lines.push(`- ${snippet}`);
  }

  if (data.themes?.length) {
    lines.push(language === "zh-CN" ? "\n反复出现的主题：" : "\nRecurring themes:");
    for (const theme of data.themes.slice(0, 6)) {
      lines.push(`- ${theme}`);
    }
  }

  if (data.promotions?.length) {
    lines.push(
      language === "zh-CN"
        ? "\n已经沉淀为长期记忆的内容："
        : "\nMemories that crystallized into something lasting:",
    );
    for (const promo of data.promotions.slice(0, 5)) {
      lines.push(`- ${promo}`);
    }
  }

  if (options.evolutionContext?.reportLines.length) {
    lines.push(language === "zh-CN" ? "\n最近的进化线索：" : "\nRecent evolution signals:");
    for (const line of options.evolutionContext.reportLines) {
      lines.push(`- ${line}`);
    }
  }

  if (options.evolutionContext?.proposalTitles.length) {
    lines.push(
      language === "zh-CN" ? "\n最近形成的规则或技能提案：" : "\nRecent rule or skill proposals:",
    );
    for (const title of options.evolutionContext.proposalTitles.slice(0, 4)) {
      lines.push(`- ${title}`);
    }
  }

  return lines.join("\n");
}

// ── Message extraction ─────────────────────────────────────────────────

export function extractNarrativeText(messages: unknown[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      continue;
    }
    const record = msg as Record<string, unknown>;
    if (record.role !== "assistant") {
      continue;
    }
    const content = record.content;
    if (typeof content === "string" && content.trim().length > 0) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const text = content
        .filter(
          (part: unknown) =>
            part &&
            typeof part === "object" &&
            !Array.isArray(part) &&
            (part as Record<string, unknown>).type === "text" &&
            typeof (part as Record<string, unknown>).text === "string",
        )
        .map((part) => (part as { text: string }).text)
        .join("\n")
        .trim();
      if (text.length > 0) {
        return text;
      }
    }
  }
  return null;
}

// ── Date formatting ────────────────────────────────────────────────────

export function formatNarrativeDate(epochMs: number, timezone?: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    // Always include the timezone abbreviation so the reader knows which
    // timezone the timestamp refers to.  Without this, users who haven't
    // configured a timezone see bare times that look local but are actually
    // UTC, causing confusion (see #65027).
    timeZoneName: "short",
  };
  return new Intl.DateTimeFormat("en-US", opts).format(new Date(epochMs));
}

// ── DREAMS.md file I/O ─────────────────────────────────────────────────

async function resolveDreamsPath(workspaceDir: string): Promise<string> {
  for (const name of DREAMS_FILENAMES) {
    const target = path.join(workspaceDir, name);
    try {
      await fs.access(target);
      return target;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        throw err;
      }
    }
  }
  return path.join(workspaceDir, DREAMS_FILENAMES[0]);
}

async function readDreamsFile(dreamsPath: string): Promise<string> {
  try {
    return await fs.readFile(dreamsPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return "";
    }
    throw err;
  }
}

function ensureDiarySection(existing: string): string {
  if (existing.includes(DIARY_START_MARKER) && existing.includes(DIARY_END_MARKER)) {
    return existing;
  }
  const diarySection = `# Dream Diary\n\n${DIARY_START_MARKER}\n${DIARY_END_MARKER}\n`;
  if (existing.trim().length === 0) {
    return diarySection;
  }
  return diarySection + "\n" + existing;
}

function replaceDiaryContent(existing: string, diaryContent: string): string {
  const ensured = ensureDiarySection(existing);
  const startIdx = ensured.indexOf(DIARY_START_MARKER);
  const endIdx = ensured.indexOf(DIARY_END_MARKER);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    return ensured;
  }
  const before = ensured.slice(0, startIdx + DIARY_START_MARKER.length);
  const after = ensured.slice(endIdx);
  const normalized = diaryContent.trim().length > 0 ? `\n${diaryContent.trim()}\n` : "\n";
  return before + normalized + after;
}

function splitDiaryBlocks(diaryContent: string): string[] {
  return diaryContent
    .split(/\n---\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

function normalizeDiaryBlockFingerprint(block: string): string {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  let dateLine = "";
  const bodyLines: string[] = [];
  for (const line of lines) {
    if (!dateLine && line.startsWith("*") && line.endsWith("*") && line.length > 2) {
      dateLine = line.slice(1, -1).trim();
      continue;
    }
    if (line.startsWith("<!--") || line.startsWith("#")) {
      continue;
    }
    bodyLines.push(line);
  }
  const normalizedDate = dateLine.replace(/\s+/g, " ").trim();
  const normalizedBody = bodyLines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return `${normalizedDate}\n${normalizedBody}`;
}

function joinDiaryBlocks(blocks: string[]): string {
  if (blocks.length === 0) {
    return "";
  }
  return blocks.map((block) => `---\n\n${block.trim()}\n`).join("\n");
}

function stripBackfillDiaryBlocks(existing: string): { updated: string; removed: number } {
  const ensured = ensureDiarySection(existing);
  const startIdx = ensured.indexOf(DIARY_START_MARKER);
  const endIdx = ensured.indexOf(DIARY_END_MARKER);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    return { updated: ensured, removed: 0 };
  }
  const inner = ensured.slice(startIdx + DIARY_START_MARKER.length, endIdx);
  const kept: string[] = [];
  let removed = 0;
  for (const block of splitDiaryBlocks(inner)) {
    if (block.includes(BACKFILL_ENTRY_MARKER)) {
      removed += 1;
      continue;
    }
    kept.push(block);
  }
  return {
    updated: replaceDiaryContent(ensured, joinDiaryBlocks(kept)),
    removed,
  };
}

export function formatBackfillDiaryDate(isoDay: string, _timezone?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  if (!match) {
    return isoDay;
  }
  const [, year, month, day] = match;
  const opts: Intl.DateTimeFormatOptions = {
    // Preserve the source iso day exactly; backfill labels should not drift by timezone.
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  const epochMs = Date.UTC(Number(year), Number(month) - 1, Number(day), 12);
  return new Intl.DateTimeFormat("en-US", opts).format(new Date(epochMs));
}

async function assertSafeDreamsPath(dreamsPath: string): Promise<void> {
  const stat = await fs.lstat(dreamsPath).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  });
  if (!stat) {
    return;
  }
  if (stat.isSymbolicLink()) {
    throw new Error("Refusing to write symlinked DREAMS.md");
  }
  if (!stat.isFile()) {
    throw new Error("Refusing to write non-file DREAMS.md");
  }
}

async function writeDreamsFileAtomic(dreamsPath: string, content: string): Promise<void> {
  await assertSafeDreamsPath(dreamsPath);
  const existing = await fs.stat(dreamsPath).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  });
  const mode = existing?.mode ?? 0o600;
  const tempPath = `${dreamsPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, { encoding: "utf-8", flag: "wx", mode });
  await fs.chmod(tempPath, mode).catch(() => undefined);
  try {
    await fs.rename(tempPath, dreamsPath);
    await fs.chmod(dreamsPath, mode).catch(() => undefined);
  } catch (err) {
    const cleanupError = await fs.rm(tempPath, { force: true }).catch((rmErr) => rmErr);
    if (cleanupError) {
      throw new Error(
        `Atomic DREAMS.md write failed (${formatErrorMessage(err)}); cleanup also failed (${formatErrorMessage(cleanupError)})`,
        { cause: err },
      );
    }
    throw err;
  }
}

async function updateDreamsFile<T>(params: {
  workspaceDir: string;
  updater: (
    existing: string,
    dreamsPath: string,
  ) =>
    | Promise<{ content: string; result: T; shouldWrite?: boolean }>
    | {
        content: string;
        result: T;
        shouldWrite?: boolean;
      };
}): Promise<T> {
  const dreamsPath = await resolveDreamsPath(params.workspaceDir);
  await fs.mkdir(path.dirname(dreamsPath), { recursive: true });
  let lockEntry = dreamsFileLocks.get(dreamsPath);
  if (!lockEntry) {
    lockEntry = { withLock: createAsyncLock(), refs: 0 };
    dreamsFileLocks.set(dreamsPath, lockEntry);
  }
  lockEntry.refs += 1;
  try {
    return await lockEntry.withLock(async () => {
      const existing = await readDreamsFile(dreamsPath);
      const { content, result, shouldWrite = true } = await params.updater(existing, dreamsPath);
      if (shouldWrite) {
        await writeDreamsFileAtomic(dreamsPath, content.endsWith("\n") ? content : `${content}\n`);
      }
      return result;
    });
  } finally {
    lockEntry.refs -= 1;
    if (lockEntry.refs <= 0 && dreamsFileLocks.get(dreamsPath) === lockEntry) {
      dreamsFileLocks.delete(dreamsPath);
    }
  }
}

export function buildBackfillDiaryEntry(params: {
  isoDay: string;
  bodyLines: string[];
  sourcePath?: string;
  timezone?: string;
}): string {
  const dateStr = formatBackfillDiaryDate(params.isoDay, params.timezone);
  const marker = `<!-- ${BACKFILL_ENTRY_MARKER} day=${params.isoDay}${params.sourcePath ? ` source=${params.sourcePath}` : ""} -->`;
  const body = params.bodyLines
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  return [`*${dateStr}*`, marker, body].filter((part) => part.length > 0).join("\n\n");
}

export async function writeBackfillDiaryEntries(params: {
  workspaceDir: string;
  entries: Array<{
    isoDay: string;
    bodyLines: string[];
    sourcePath?: string;
  }>;
  timezone?: string;
}): Promise<{ dreamsPath: string; written: number; replaced: number }> {
  return await updateDreamsFile({
    workspaceDir: params.workspaceDir,
    updater: (existing, dreamsPath) => {
      const stripped = stripBackfillDiaryBlocks(existing);
      const startIdx = stripped.updated.indexOf(DIARY_START_MARKER);
      const endIdx = stripped.updated.indexOf(DIARY_END_MARKER);
      const inner =
        startIdx >= 0 && endIdx > startIdx
          ? stripped.updated.slice(startIdx + DIARY_START_MARKER.length, endIdx)
          : "";
      const preservedBlocks = splitDiaryBlocks(inner);
      const nextBlocks = [
        ...preservedBlocks,
        ...params.entries.map((entry) =>
          buildBackfillDiaryEntry({
            isoDay: entry.isoDay,
            bodyLines: entry.bodyLines,
            sourcePath: entry.sourcePath,
            timezone: params.timezone,
          }),
        ),
      ];
      return {
        content: replaceDiaryContent(stripped.updated, joinDiaryBlocks(nextBlocks)),
        result: {
          dreamsPath,
          written: params.entries.length,
          replaced: stripped.removed,
        },
      };
    },
  });
}

export async function removeBackfillDiaryEntries(params: {
  workspaceDir: string;
}): Promise<{ dreamsPath: string; removed: number }> {
  return await updateDreamsFile({
    workspaceDir: params.workspaceDir,
    updater: (existing, dreamsPath) => {
      const stripped = stripBackfillDiaryBlocks(existing);
      return {
        content: stripped.updated,
        result: {
          dreamsPath,
          removed: stripped.removed,
        },
        shouldWrite: stripped.removed > 0 || existing.length > 0,
      };
    },
  });
}

export async function dedupeDreamDiaryEntries(params: {
  workspaceDir: string;
}): Promise<{ dreamsPath: string; removed: number; kept: number }> {
  return await updateDreamsFile({
    workspaceDir: params.workspaceDir,
    updater: (existing, dreamsPath) => {
      const ensured = ensureDiarySection(existing);
      const startIdx = ensured.indexOf(DIARY_START_MARKER);
      const endIdx = ensured.indexOf(DIARY_END_MARKER);
      if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
        return {
          content: ensured,
          result: { dreamsPath, removed: 0, kept: 0 },
          shouldWrite: false,
        };
      }
      const inner = ensured.slice(startIdx + DIARY_START_MARKER.length, endIdx);
      const blocks = splitDiaryBlocks(inner);
      const seen = new Set<string>();
      const keptBlocks: string[] = [];
      let removed = 0;
      for (const block of blocks) {
        const fingerprint = normalizeDiaryBlockFingerprint(block);
        if (seen.has(fingerprint)) {
          removed += 1;
          continue;
        }
        seen.add(fingerprint);
        keptBlocks.push(block);
      }
      return {
        content: replaceDiaryContent(ensured, joinDiaryBlocks(keptBlocks)),
        result: {
          dreamsPath,
          removed,
          kept: keptBlocks.length,
        },
        shouldWrite: removed > 0,
      };
    },
  });
}

export function buildDiaryEntry(narrative: string, dateStr: string): string {
  return `\n---\n\n*${dateStr}*\n\n${narrative}\n`;
}

export async function appendNarrativeEntry(params: {
  workspaceDir: string;
  narrative: string;
  nowMs: number;
  timezone?: string;
}): Promise<string> {
  const dateStr = formatNarrativeDate(params.nowMs, params.timezone);
  const entry = buildDiaryEntry(params.narrative, dateStr);
  return await updateDreamsFile({
    workspaceDir: params.workspaceDir,
    updater: (existing, dreamsPath) => {
      let updated: string;
      if (existing.includes(DIARY_START_MARKER) && existing.includes(DIARY_END_MARKER)) {
        const endIdx = existing.lastIndexOf(DIARY_END_MARKER);
        updated = existing.slice(0, endIdx) + entry + "\n" + existing.slice(endIdx);
      } else if (existing.includes(DIARY_START_MARKER)) {
        const startIdx = existing.indexOf(DIARY_START_MARKER) + DIARY_START_MARKER.length;
        updated =
          existing.slice(0, startIdx) +
          entry +
          "\n" +
          DIARY_END_MARKER +
          "\n" +
          existing.slice(startIdx);
      } else {
        const diarySection = `# Dream Diary\n\n${DIARY_START_MARKER}${entry}\n${DIARY_END_MARKER}\n`;
        updated = existing.trim().length === 0 ? diarySection : `${diarySection}\n${existing}`;
      }
      return { content: updated, result: dreamsPath };
    },
  });
}

// ── Orchestrator ───────────────────────────────────────────────────────

async function safePathExists(pathname: string): Promise<boolean> {
  try {
    await fs.stat(pathname);
    return true;
  } catch {
    return false;
  }
}

function normalizeComparablePath(pathname: string): string {
  return process.platform === "win32" ? pathname.toLowerCase() : pathname;
}

async function normalizeSessionFileForComparison(params: {
  sessionsDir: string;
  sessionFile: string;
}): Promise<string | null> {
  const trimmed = params.sessionFile.trim();
  if (!trimmed) {
    return null;
  }
  const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(params.sessionsDir, trimmed);
  try {
    return normalizeComparablePath(await fs.realpath(resolved));
  } catch {
    return normalizeComparablePath(path.resolve(resolved));
  }
}

function isDreamingSessionStoreKey(sessionKey: string): boolean {
  const firstSeparator = sessionKey.indexOf(":");
  if (firstSeparator < 0) {
    return sessionKey.startsWith(DREAMING_SESSION_KEY_PREFIX);
  }
  const secondSeparator = sessionKey.indexOf(":", firstSeparator + 1);
  const sessionSegment = secondSeparator < 0 ? sessionKey : sessionKey.slice(secondSeparator + 1);
  return sessionSegment.startsWith(DREAMING_SESSION_KEY_PREFIX);
}

async function normalizeSessionEntryPathForComparison(params: {
  sessionsDir: string;
  entry: { sessionFile?: string; sessionId?: string } | undefined;
}): Promise<string | null> {
  const sessionFile = typeof params.entry?.sessionFile === "string" ? params.entry.sessionFile : "";
  if (sessionFile) {
    return normalizeSessionFileForComparison({
      sessionsDir: params.sessionsDir,
      sessionFile,
    });
  }
  const sessionId =
    typeof params.entry?.sessionId === "string" ? params.entry.sessionId.trim() : "";
  if (!SAFE_SESSION_ID_RE.test(sessionId)) {
    return null;
  }
  return normalizeSessionFileForComparison({
    sessionsDir: params.sessionsDir,
    sessionFile: `${sessionId}.jsonl`,
  });
}

async function scrubDreamingNarrativeArtifacts(logger: Logger): Promise<void> {
  const cfg = loadConfig();
  const agentsDir = path.join(resolveStateDir(), "agents");
  let agentEntries: Dirent[] = [];
  try {
    agentEntries = await fs.readdir(agentsDir, { withFileTypes: true });
  } catch {
    return;
  }

  let prunedEntries = 0;
  let archivedOrphans = 0;

  for (const agentEntry of agentEntries) {
    if (!agentEntry.isDirectory()) {
      continue;
    }

    const storePath = resolveStorePath(cfg.session?.store, { agentId: agentEntry.name });
    const sessionsDir = path.dirname(storePath);
    let store: Record<string, { sessionFile?: string; sessionId?: string } | undefined>;
    try {
      store = loadSessionStore(storePath) as Record<
        string,
        { sessionFile?: string; sessionId?: string } | undefined
      >;
    } catch {
      continue;
    }

    const referencedSessionFiles = new Set<string>();
    let needsStoreUpdate = false;
    for (const [key, entry] of Object.entries(store)) {
      const normalizedSessionFile = await normalizeSessionEntryPathForComparison({
        sessionsDir,
        entry,
      });
      if (normalizedSessionFile) {
        referencedSessionFiles.add(normalizedSessionFile);
      }
      if (!isDreamingSessionStoreKey(key)) {
        continue;
      }
      if (!normalizedSessionFile || !(await safePathExists(normalizedSessionFile))) {
        needsStoreUpdate = true;
      }
    }

    if (needsStoreUpdate) {
      referencedSessionFiles.clear();
      prunedEntries += await updateSessionStore(storePath, async (lockedStore) => {
        let prunedForAgent = 0;
        for (const [key, entry] of Object.entries(lockedStore)) {
          const normalizedSessionFile = await normalizeSessionEntryPathForComparison({
            sessionsDir,
            entry,
          });
          if (normalizedSessionFile) {
            referencedSessionFiles.add(normalizedSessionFile);
          }
          if (!isDreamingSessionStoreKey(key)) {
            continue;
          }
          if (!normalizedSessionFile || !(await safePathExists(normalizedSessionFile))) {
            delete lockedStore[key];
            prunedForAgent += 1;
          }
        }
        return prunedForAgent;
      });
    }

    let sessionFiles: Dirent[] = [];
    try {
      sessionFiles = await fs.readdir(sessionsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const fileEntry of sessionFiles) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith(".jsonl")) {
        continue;
      }
      const transcriptPath = path.join(sessionsDir, fileEntry.name);
      const normalizedTranscriptPath =
        (await normalizeSessionFileForComparison({
          sessionsDir,
          sessionFile: fileEntry.name,
        })) ?? normalizeComparablePath(transcriptPath);
      if (referencedSessionFiles.has(normalizedTranscriptPath)) {
        continue;
      }
      let stat;
      try {
        stat = await fs.stat(transcriptPath);
      } catch {
        continue;
      }
      if (Date.now() - stat.mtimeMs < DREAMING_ORPHAN_MIN_AGE_MS) {
        continue;
      }
      let content = "";
      try {
        content = await fs.readFile(transcriptPath, "utf-8");
      } catch {
        continue;
      }
      if (!content.includes(DREAMING_TRANSCRIPT_RUN_MARKER)) {
        continue;
      }
      const archivedPath = `${transcriptPath}.deleted.${Date.now()}`;
      try {
        await fs.rename(transcriptPath, archivedPath);
        archivedOrphans += 1;
      } catch {
        // best-effort scrubber
      }
    }
  }

  if (prunedEntries > 0 || archivedOrphans > 0) {
    logger.info(
      `memory-core: dreaming cleanup scrubbed ${prunedEntries} stale session entr${prunedEntries === 1 ? "y" : "ies"} and archived ${archivedOrphans} orphan transcript${archivedOrphans === 1 ? "" : "s"}.`,
    );
  }
}

export async function generateAndAppendDreamNarrative(params: {
  subagent: SubagentSurface;
  workspaceDir: string;
  data: NarrativePhaseData;
  nowMs?: number;
  language?: NarrativeLanguage;
  timezone?: string;
  logger: Logger;
}): Promise<void> {
  const nowMs = Number.isFinite(params.nowMs) ? (params.nowMs as number) : Date.now();

  if (params.data.snippets.length === 0 && !params.data.promotions?.length) {
    return;
  }

  const sessionKey = buildNarrativeSessionKey({
    workspaceDir: params.workspaceDir,
    phase: params.data.phase,
    nowMs,
  });
  const evolutionContext = await loadEvolutionNarrativeContext(params.workspaceDir);
  const language = resolveNarrativeLanguage(params.language, params.data, evolutionContext);
  const message = buildNarrativePrompt(params.data, {
    language,
    evolutionContext,
  });
  let runId: string | null = null;
  let waitStatus: string | null = null;

  try {
    runId = await startNarrativeRunOrFallback({
      subagent: params.subagent,
      sessionKey,
      message,
      language,
      data: params.data,
      workspaceDir: params.workspaceDir,
      nowMs,
      timezone: params.timezone,
      logger: params.logger,
    });
    if (!runId) {
      return;
    }

    const result = await params.subagent.waitForRun({
      runId,
      timeoutMs: NARRATIVE_TIMEOUT_MS,
    });
    waitStatus = result.status;

    if (result.status !== "ok") {
      params.logger.warn(
        `memory-core: narrative generation ended with status=${result.status} for ${params.data.phase} phase.`,
      );
      return;
    }

    const { messages } = await params.subagent.getSessionMessages({
      sessionKey,
      limit: 5,
    });

    const narrative = extractNarrativeText(messages);
    if (!narrative) {
      params.logger.warn(
        `memory-core: narrative generation produced no text for ${params.data.phase} phase.`,
      );
      return;
    }

    await appendNarrativeEntry({
      workspaceDir: params.workspaceDir,
      narrative,
      nowMs,
      timezone: params.timezone,
    });

    params.logger.info(
      `memory-core: dream diary entry written for ${params.data.phase} phase [workspace=${params.workspaceDir}].`,
    );
  } catch (err) {
    // Narrative generation is best-effort — never fail the parent phase.
    params.logger.warn(
      `memory-core: narrative generation failed for ${params.data.phase} phase: ${formatErrorMessage(err)}`,
    );
  } finally {
    if (params.subagent && runId && waitStatus === "timeout") {
      try {
        const settle = await params.subagent.waitForRun({
          runId,
          timeoutMs: NARRATIVE_DELETE_SETTLE_TIMEOUT_MS,
        });
        if (settle.status !== "ok" && settle.status !== "error") {
          params.logger.warn(
            `memory-core: narrative cleanup wait ended with status=${settle.status} for ${params.data.phase} phase.`,
          );
        }
      } catch (cleanupWaitErr) {
        params.logger.warn(
          `memory-core: narrative cleanup wait failed for ${params.data.phase} phase: ${formatErrorMessage(cleanupWaitErr)}`,
        );
      }
    }

    // Guard against subagent becoming unavailable mid-flight (throws TypeError without this).
    if (params.subagent) {
      try {
        await params.subagent.deleteSession({ sessionKey });
      } catch (cleanupErr) {
        params.logger.warn(
          `memory-core: narrative session cleanup failed for ${params.data.phase} phase: ${formatErrorMessage(cleanupErr)}`,
        );
      }
    }

    await scrubDreamingNarrativeArtifacts(params.logger).catch((scrubErr: unknown) => {
      params.logger.warn(
        `memory-core: dreaming cleanup scrub failed for ${params.data.phase} phase: ${formatErrorMessage(scrubErr)}`,
      );
    });
  }
}
