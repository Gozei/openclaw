import fs from "node:fs/promises";
import path from "node:path";
import type { ReflectionEvent } from "./types.js";

type ParsedWorkflowProposal = {
  title: string;
  trigger: string;
  steps: string[];
  tools: string[];
  successCriteria: string[];
  fallbackNotes: string[];
};

function normalizeLine(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function slugify(value: string): string {
  return normalizeLine(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function escapeFrontmatterValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

function buildSkillDescription(parsed: ParsedWorkflowProposal): string {
  const parts = [`${parsed.title}. Use when ${parsed.trigger}.`];
  const firstStep = parsed.steps[0];
  if (firstStep) {
    parts.push(`Start with: ${firstStep}.`);
  }
  if (parsed.tools.length > 0) {
    parts.push(`Prefer: ${parsed.tools.slice(0, 2).join(", ")}.`);
  }
  return normalizeLine(parts.join(" ")).slice(0, 220);
}

function extractMatchSignals(parsed: ParsedWorkflowProposal): string[] {
  return Array.from(
    new Set(
      [parsed.title, parsed.trigger, ...parsed.tools, ...parsed.steps, ...parsed.successCriteria]
        .flatMap((value) => value.split(/[^A-Za-z0-9]+/g))
        .map((value) => normalizeLine(value))
        .filter((value) => value.length >= 3),
    ),
  ).slice(0, 8);
}

function parseListSection(
  lines: string[],
  startIndex: number,
): {
  values: string[];
  nextIndex: number;
} {
  const values: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      index += 1;
      continue;
    }
    if (/^[A-Za-z][A-Za-z ]+:\s*$/.test(line)) {
      break;
    }
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    const bulleted = line.match(/^-\s+(.+)$/);
    const value = numbered?.[1] ?? bulleted?.[1] ?? line;
    const normalized = normalizeLine(value);
    if (normalized) {
      values.push(normalized);
    }
    index += 1;
  }
  return { values, nextIndex: index };
}

export function parseWorkflowProposal(content: string): ParsedWorkflowProposal | null {
  const lines = content.split("\n");
  const title = normalizeLine(
    lines.find((line) => /^Title:\s*/i.test(line))?.replace(/^Title:\s*/i, "") ?? "",
  );
  const trigger = normalizeLine(
    lines.find((line) => /^Trigger:\s*/i.test(line))?.replace(/^Trigger:\s*/i, "") ?? "",
  );
  if (!title || !trigger) {
    return null;
  }

  const sections = {
    steps: [] as string[],
    tools: [] as string[],
    successCriteria: [] as string[],
    fallbackNotes: [] as string[],
  };

  for (let index = 0; index < lines.length; ) {
    const line = lines[index]?.trim() ?? "";
    if (line === "Steps:") {
      const parsed = parseListSection(lines, index + 1);
      sections.steps = parsed.values;
      index = parsed.nextIndex;
      continue;
    }
    if (line === "Tools:") {
      const parsed = parseListSection(lines, index + 1);
      sections.tools = parsed.values;
      index = parsed.nextIndex;
      continue;
    }
    if (line === "Success Criteria:") {
      const parsed = parseListSection(lines, index + 1);
      sections.successCriteria = parsed.values;
      index = parsed.nextIndex;
      continue;
    }
    if (line === "Fallback Notes:") {
      const parsed = parseListSection(lines, index + 1);
      sections.fallbackNotes = parsed.values;
      index = parsed.nextIndex;
      continue;
    }
    index += 1;
  }

  if (sections.steps.length === 0) {
    return null;
  }

  return {
    title,
    trigger,
    steps: sections.steps,
    tools: sections.tools,
    successCriteria: sections.successCriteria,
    fallbackNotes: sections.fallbackNotes,
  };
}

export function buildGeneratedSkillMarkdown(params: {
  proposalContent: string;
  reflectionEvent: ReflectionEvent;
}): { skillName: string; dirName: string; markdown: string } | null {
  const parsed = parseWorkflowProposal(params.proposalContent);
  if (!parsed) {
    return null;
  }
  const slug = slugify(parsed.title);
  if (!slug) {
    return null;
  }
  const skillName = `evolution-${slug}`;
  const description = buildSkillDescription(parsed);
  const quickStart = parsed.steps.slice(0, 3);
  const matchSignals = extractMatchSignals(parsed);
  const lines = [
    "---",
    `name: ${skillName}`,
    `description: "${escapeFrontmatterValue(description)}"`,
    "---",
    "",
    "# Purpose",
    "",
    `Use this generated skill when: ${parsed.trigger}`,
    "",
    "# Quick Start",
    "",
    ...(quickStart.length > 0
      ? quickStart.map((step, index) => `${index + 1}. ${step}`)
      : ["1. Confirm the task still matches this skill's trigger."]),
    "",
    "# Workflow",
    "",
    ...parsed.steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "# Success Criteria",
    "",
    ...(parsed.successCriteria.length > 0
      ? parsed.successCriteria.map((criterion) => `- ${criterion}`)
      : ["- The task reaches a successful terminal state."]),
    "",
    "# Fallbacks",
    "",
    ...(parsed.fallbackNotes.length > 0
      ? parsed.fallbackNotes.map((note) => `- ${note}`)
      : ["- If the trigger does not match, stop using this skill and adapt to the current task."]),
    "",
    "# Tool Preferences",
    "",
    ...(parsed.tools.length > 0
      ? parsed.tools.map((tool) => `- Prefer \`${tool}\` when it clearly fits this workflow.`)
      : ["- Use the smallest safe tool surface that completes the workflow."]),
    "",
    "# Trigger Match Signals",
    "",
    ...(matchSignals.length > 0
      ? matchSignals.map((signal) => `- ${signal}`)
      : ["- Reuse this skill only when the task language strongly matches the trigger."]),
    "",
    "# When Not To Use",
    "",
    "- Do not use this skill when the request no longer matches the trigger.",
    "- Do not force the workflow if newer repo state or user instructions conflict.",
    "",
    "# Provenance",
    "",
    `- Generated from reflection event \`${params.reflectionEvent.id}\`.`,
    `- Source: ${params.reflectionEvent.source}.`,
    `- Outcome summary: ${params.reflectionEvent.outcomeSummary}.`,
    "",
  ];
  return {
    skillName,
    dirName: skillName,
    markdown: lines.join("\n").trimEnd() + "\n",
  };
}

export async function writeGeneratedSkillDraft(params: {
  workspaceDir: string;
  proposalContent: string;
  reflectionEvent: ReflectionEvent;
}): Promise<string | null> {
  const draft = buildGeneratedSkillMarkdown({
    proposalContent: params.proposalContent,
    reflectionEvent: params.reflectionEvent,
  });
  if (!draft) {
    return null;
  }
  const skillDir = path.join(params.workspaceDir, "skills", draft.dirName);
  const filePath = path.join(skillDir, "SKILL.md");
  await fs.mkdir(skillDir, { recursive: true });
  let existing = "";
  try {
    existing = await fs.readFile(filePath, "utf-8");
  } catch {
    existing = "";
  }
  if (existing !== draft.markdown) {
    await fs.writeFile(filePath, draft.markdown, "utf-8");
  }
  return filePath;
}
