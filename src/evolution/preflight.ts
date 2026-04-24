import fs from "node:fs/promises";
import path from "node:path";
import { loadFailureRegistry } from "./failure-registry.js";
import { loadWorkflowRegistry, type WorkflowRegistryEntry } from "./workflow-registry.js";

export type EvolutionRecallSkillMatch = {
  name: string;
  path: string;
  summary: string;
  firstCue?: string;
};

export type EvolutionRecallWorkflowMatch = {
  key: string;
  title?: string;
  trigger?: string;
  firstStep?: string;
  successCue?: string;
  reuseCount: number;
};

export type EvolutionRecallFailureMatch = {
  signature: string;
  workaround?: string;
  count: number;
};

export type EvolutionRecallTrace = {
  sourceLabel?: string;
  openingMove?: string;
  recommendedActions: string[];
  matchedSkills: EvolutionRecallSkillMatch[];
  matchedWorkflows: EvolutionRecallWorkflowMatch[];
  matchedFailures: EvolutionRecallFailureMatch[];
};

export type EvolutionPreflightResult = {
  prompt: string;
  recall: EvolutionRecallTrace;
};

type RecallItem = {
  text: string;
  score: number;
};

type ScoredItem<T> = {
  score: number;
  sortKey: string;
  value: T;
};

type ScoredAction = {
  text: string;
  score: number;
};

const EVOLUTION_SKILLS_DIR = path.join("skills");
const MAX_ITEMS_PER_BUCKET = 3;

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 2);
}

function scoreText(queryTokens: string[], text: string): number {
  if (queryTokens.length === 0) {
    return 0;
  }
  const haystack = text.toLowerCase();
  const unique = new Set(queryTokens);
  let score = 0;
  for (const token of unique) {
    if (haystack.includes(token)) {
      score += token.length;
    }
  }
  return score;
}

function scoreWorkflowEntry(queryTokens: string[], entry: WorkflowRegistryEntry): number {
  const corpus = [
    entry.key,
    entry.title ?? "",
    entry.trigger ?? "",
    ...(entry.steps ?? []),
    ...(entry.tools ?? []),
    ...(entry.successCriteria ?? []),
    ...(entry.fallbackNotes ?? []),
    entry.lastSummary ?? "",
  ].join(" ");
  const baseScore = scoreText(queryTokens, corpus);
  return baseScore > 0 ? baseScore + Math.min(entry.count, 3) : 0;
}

function parseGeneratedSkillSection(content: string, heading: string): string[] {
  const lines = content.split("\n");
  const sectionStart = lines.findIndex((line) => line.trim() === heading);
  if (sectionStart < 0) {
    return [];
  }
  const values: string[] = [];
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      continue;
    }
    if (line.startsWith("# ")) {
      break;
    }
    const normalized = line
      .replace(/^\d+\.\s+/, "")
      .replace(/^-\s+/, "")
      .trim();
    if (normalized) {
      values.push(normalized);
    }
  }
  return values;
}

async function loadGeneratedSkills(
  workspaceDir: string,
): Promise<Array<{ name: string; path: string; summary: string; cues: string[] }>> {
  const skillsDir = path.join(workspaceDir, EVOLUTION_SKILLS_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(skillsDir);
  } catch {
    return [];
  }
  const results = await Promise.all(
    entries
      .filter((name) => name.startsWith("evolution-"))
      .map(async (name) => {
        const filePath = path.join(skillsDir, name, "SKILL.md");
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const description =
            content.match(/^description:\s+"?(.+?)"?$/m)?.[1]?.trim() ??
            content.match(/^Use this generated skill when:\s+(.+)$/m)?.[1]?.trim() ??
            "";
          const quickStart = parseGeneratedSkillSection(content, "# Quick Start");
          const workflow = parseGeneratedSkillSection(content, "# Workflow");
          const matchSignals = parseGeneratedSkillSection(content, "# Trigger Match Signals");
          return {
            name,
            path: path.join("skills", name, "SKILL.md").split(path.sep).join("/"),
            summary: description,
            cues: [...quickStart, ...workflow.slice(0, 3), ...matchSignals],
          };
        } catch {
          return null;
        }
      }),
  );
  return results.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function selectTopScoredItems<T>(items: ScoredItem<T>[]): T[] {
  return items
    .filter((item) => item.score > 0)
    .toSorted(
      (left, right) => right.score - left.score || left.sortKey.localeCompare(right.sortKey),
    )
    .slice(0, MAX_ITEMS_PER_BUCKET)
    .map((item) => item.value);
}

function selectTopItems(items: RecallItem[]): string[] {
  return items
    .filter((item) => item.score > 0)
    .toSorted((left, right) => right.score - left.score || left.text.localeCompare(right.text))
    .slice(0, MAX_ITEMS_PER_BUCKET)
    .map((item) => item.text);
}

function selectTopActions(items: ScoredAction[]): string[] {
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const item of items.toSorted(
    (left, right) => right.score - left.score || left.text.localeCompare(right.text),
  )) {
    const normalized = item.text.trim();
    if (!normalized || item.score <= 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    selected.push(normalized);
    if (selected.length >= MAX_ITEMS_PER_BUCKET) {
      break;
    }
  }
  return selected;
}

function buildWorkflowRecallText(entry: WorkflowRegistryEntry): string {
  if (entry.title && entry.trigger) {
    const firstStep = entry.steps?.[0];
    const firstSuccess = entry.successCriteria?.[0];
    const parts = [`${entry.title} (${entry.trigger})`];
    if (firstStep) {
      parts.push(`Start with: ${firstStep}`);
    }
    if (firstSuccess) {
      parts.push(`Success looks like: ${firstSuccess}`);
    }
    parts.push(`reused ${entry.count} times`);
    return parts.join(". ");
  }
  return `${entry.key} (reused ${entry.count} times)`;
}

function buildSkillRecallText(entry: EvolutionRecallSkillMatch): string {
  return entry.firstCue
    ? `${entry.name} (${entry.path}): ${entry.summary} Quick start: ${entry.firstCue}`
    : `${entry.name} (${entry.path}): ${entry.summary}`;
}

function buildWorkflowMatch(entry: WorkflowRegistryEntry): EvolutionRecallWorkflowMatch {
  return {
    key: entry.key,
    ...(entry.title ? { title: entry.title } : {}),
    ...(entry.trigger ? { trigger: entry.trigger } : {}),
    ...(entry.steps?.[0] ? { firstStep: entry.steps[0] } : {}),
    ...(entry.successCriteria?.[0] ? { successCue: entry.successCriteria[0] } : {}),
    reuseCount: entry.count,
  };
}

function buildFailureMatch(entry: Awaited<ReturnType<typeof loadFailureRegistry>>[number]) {
  return {
    signature: entry.signature,
    ...(entry.lastWorkaround?.trim() ? { workaround: entry.lastWorkaround.trim() } : {}),
    count: entry.count,
  } satisfies EvolutionRecallFailureMatch;
}

export function buildEvolutionRecallNotice(
  recall: EvolutionRecallTrace | undefined,
): string | undefined {
  if (!recall) {
    return undefined;
  }
  const lines = [
    recall.sourceLabel ? `Recall: ${recall.sourceLabel}` : "Recall: matched prior experience",
    recall.openingMove ? `First move: ${recall.openingMove}` : undefined,
  ].filter((line): line is string => Boolean(line?.trim()));
  return lines.length > 0 ? lines.join("\n") : undefined;
}

export async function buildEvolutionPreflight(params: {
  workspaceDir: string;
  userPrompt: string;
}): Promise<EvolutionPreflightResult | undefined> {
  const queryTokens = tokenize(params.userPrompt);
  if (queryTokens.length === 0) {
    return undefined;
  }
  const [failures, workflows, generatedSkills] = await Promise.all([
    loadFailureRegistry(params.workspaceDir),
    loadWorkflowRegistry(params.workspaceDir),
    loadGeneratedSkills(params.workspaceDir),
  ]);

  const topFailures = selectTopScoredItems(
    failures.map((entry) => ({
      sortKey: entry.signature,
      value: buildFailureMatch(entry),
      score: scoreText(queryTokens, `${entry.signature} ${entry.lastWorkaround ?? ""}`),
    })),
  );
  const topWorkflows = selectTopScoredItems(
    workflows.map((entry) => ({
      sortKey: entry.title ?? entry.key,
      value: buildWorkflowMatch(entry),
      score: scoreWorkflowEntry(queryTokens, entry),
    })),
  );
  const topSkills = selectTopScoredItems(
    generatedSkills.map((entry) => ({
      sortKey: entry.name,
      value: {
        name: entry.name,
        path: entry.path,
        summary: entry.summary,
        ...(entry.cues[0] ? { firstCue: entry.cues[0] } : {}),
      } satisfies EvolutionRecallSkillMatch,
      score: scoreText(
        queryTokens,
        `${entry.name} ${entry.path} ${entry.summary} ${entry.cues.join(" ")}`,
      ),
    })),
  );
  const topFailureTexts = selectTopItems(
    failures.map((entry) => ({
      text:
        entry.lastWorkaround && entry.lastWorkaround.trim()
          ? `${entry.signature} -> ${entry.lastWorkaround.trim()}`
          : `${entry.signature} (seen ${entry.count} times)`,
      score: scoreText(queryTokens, `${entry.signature} ${entry.lastWorkaround ?? ""}`),
    })),
  );
  const topWorkflowTexts = topWorkflows.map((entry) =>
    buildWorkflowRecallText({
      key: entry.key,
      count: entry.reuseCount,
      firstSeenAt: 0,
      lastSeenAt: 0,
      ...(entry.title ? { title: entry.title } : {}),
      ...(entry.trigger ? { trigger: entry.trigger } : {}),
      ...(entry.firstStep ? { steps: [entry.firstStep] } : {}),
      ...(entry.successCue ? { successCriteria: [entry.successCue] } : {}),
    }),
  );
  const topSkillTexts = topSkills.map((entry) => buildSkillRecallText(entry));
  const recommendedActions = selectTopActions([
    ...generatedSkills.map((entry) => ({
      text: entry.cues[0] ? `Start with recalled skill step: ${entry.cues[0]}` : "",
      score: scoreText(queryTokens, `${entry.name} ${entry.summary} ${entry.cues.join(" ")}`),
    })),
    ...failures.map((entry) => ({
      text:
        entry.lastWorkaround && entry.lastWorkaround.trim()
          ? `Avoid the known failure by doing this first: ${entry.lastWorkaround.trim()}`
          : "",
      score: scoreText(queryTokens, `${entry.signature} ${entry.lastWorkaround ?? ""}`),
    })),
    ...workflows.map((entry) => ({
      text:
        entry.steps?.[0] && entry.title
          ? `Use the recent workflow start from ${entry.title}: ${entry.steps[0]}`
          : entry.steps?.[0]
            ? `Use the recent workflow start: ${entry.steps[0]}`
            : "",
      score: scoreWorkflowEntry(queryTokens, entry),
    })),
  ]);

  if (
    topFailures.length === 0 &&
    topWorkflows.length === 0 &&
    topSkills.length === 0 &&
    recommendedActions.length === 0
  ) {
    return undefined;
  }

  const lines = [
    "## Evolution Recall",
    "Before acting, check whether any recalled skill, repeated failure, or reusable workflow matches this task.",
    "If a generated evolution skill clearly fits, prefer reading that SKILL.md before improvising.",
    "",
  ];
  if (recommendedActions.length > 0) {
    lines.push(
      "Recommended first moves from prior experience:",
      ...recommendedActions.map((line) => `- ${line}`),
      "",
    );
  }
  if (topSkillTexts.length > 0) {
    lines.push(
      "Generated skills likely relevant:",
      ...topSkillTexts.map((line) => `- ${line}`),
      "Read the matching SKILL.md before improvising when one clearly fits.",
      "",
    );
  }
  if (topWorkflowTexts.length > 0) {
    lines.push(
      "Reusable workflows likely relevant:",
      ...topWorkflowTexts.map((line) => `- ${line}`),
      "If no generated skill clearly fits, follow the matching workflow's opening steps before improvising.",
      "",
    );
  }
  if (topFailureTexts.length > 0) {
    lines.push("Repeated failures to avoid:", ...topFailureTexts.map((line) => `- ${line}`), "");
  }
  return {
    prompt: lines.join("\n").trimEnd(),
    recall: {
      ...(topWorkflows[0]?.title
        ? { sourceLabel: topWorkflows[0].title }
        : topSkills[0]?.name
          ? { sourceLabel: topSkills[0].name }
          : topFailures[0]?.signature
            ? { sourceLabel: topFailures[0].signature }
            : {}),
      ...(topSkills[0]?.firstCue
        ? { openingMove: topSkills[0].firstCue }
        : topWorkflows[0]?.firstStep
          ? { openingMove: topWorkflows[0].firstStep }
          : topFailures[0]?.workaround
            ? { openingMove: topFailures[0].workaround }
            : {}),
      recommendedActions,
      matchedSkills: topSkills,
      matchedWorkflows: topWorkflows,
      matchedFailures: topFailures,
    },
  };
}

export async function buildEvolutionPreflightPrompt(params: {
  workspaceDir: string;
  userPrompt: string;
}): Promise<string | undefined> {
  return (await buildEvolutionPreflight(params))?.prompt;
}
