import fs from "node:fs/promises";
import path from "node:path";
import { loadFailureRegistry } from "./failure-registry.js";
import {
  buildEvolutionComparison,
  loadEvolutionMetrics,
  type EvolutionDayMetrics,
} from "./metrics.js";
import { isOperationalFailureNoise } from "./noise.js";
import type { FailureRegistryEntry } from "./types.js";
import { loadWorkflowRegistry, type WorkflowRegistryEntry } from "./workflow-registry.js";

export type EvolutionDashboardExcerpt = {
  path: string;
  content: string;
};

export type EvolutionDashboardProposal = {
  kind: "rule_proposal" | "skill_proposal";
  title: string;
  path: string;
  createdAt?: string;
  preview: string;
};

export type EvolutionDashboardGeneratedSkill = {
  title: string;
  path: string;
  updatedAt?: string;
  preview: string;
};

export type EvolutionDashboardSnapshot = {
  days: EvolutionDayMetrics[];
  comparison: ReturnType<typeof buildEvolutionComparison>;
  latestDailyMemory: EvolutionDashboardExcerpt | null;
  latestReport: EvolutionDashboardExcerpt | null;
  failures: FailureRegistryEntry[];
  workflows: WorkflowRegistryEntry[];
  generatedSkills: EvolutionDashboardGeneratedSkill[];
  proposals: {
    rules: EvolutionDashboardProposal[];
    skills: EvolutionDashboardProposal[];
  };
};

const EVOLUTION_DIR = path.join("memory", ".evolution");
const REPORTS_DIR = path.join(EVOLUTION_DIR, "reports");
const RULES_DIR = path.join(EVOLUTION_DIR, "proposals", "rules");
const SKILLS_DIR = path.join(EVOLUTION_DIR, "proposals", "skills");
const MAX_EXCERPT_CHARS = 2400;
const MAX_PROPOSALS = 6;

function trimExcerpt(content: string, maxChars = MAX_EXCERPT_CHARS): string {
  const normalized = content.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars).trimEnd()}\n...`;
}

function toWorkspaceRelativePath(workspaceDir: string, filePath: string): string {
  return path.relative(workspaceDir, filePath).split(path.sep).join("/");
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function readExcerptFile(
  workspaceDir: string,
  filePath: string,
): Promise<EvolutionDashboardExcerpt | null> {
  const raw = await readTextFile(filePath);
  if (!raw) {
    return null;
  }
  const normalizedContent = filePath.endsWith(".md")
    ? raw
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith("- Failed:")) {
            return true;
          }
          return !isOperationalFailureNoise(trimmed.replace(/^- Failed:\s*/i, ""));
        })
        .join("\n")
    : raw;
  return {
    path: toWorkspaceRelativePath(workspaceDir, filePath),
    content: trimExcerpt(normalizedContent),
  };
}

function parseProposalTitle(content: string, fallbackName: string): string {
  const heading = content.match(/^#\s+(?:Rule Proposal|Skill Proposal):\s+(.+)$/m)?.[1]?.trim();
  return heading || fallbackName;
}

function parseProposalCreatedAt(content: string): string | undefined {
  const raw = content.match(/^Created At:\s+(.+)$/m)?.[1]?.trim();
  return raw || undefined;
}

function buildProposalPreview(content: string): string {
  const lines = content
    .split("\n")
    .filter((line) => !line.startsWith("# "))
    .filter((line) => !line.startsWith("Created At:"))
    .filter((line) => !line.startsWith("Reflection Event:"))
    .join("\n")
    .trim();
  return trimExcerpt(lines || content);
}

async function loadProposalBucket(params: {
  workspaceDir: string;
  kind: EvolutionDashboardProposal["kind"];
  dirPath: string;
}): Promise<EvolutionDashboardProposal[]> {
  let names: string[];
  try {
    names = await fs.readdir(params.dirPath);
  } catch {
    return [];
  }
  const files = await Promise.all(
    names
      .filter((name) => name.toLowerCase().endsWith(".md"))
      .map(async (name) => {
        const fullPath = path.join(params.dirPath, name);
        try {
          const [stat, content] = await Promise.all([
            fs.stat(fullPath),
            fs.readFile(fullPath, "utf-8"),
          ]);
          return {
            fullPath,
            mtimeMs: stat.mtimeMs,
            content,
            name,
          };
        } catch {
          return null;
        }
      }),
  );
  return files
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .toSorted((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
    .slice(0, MAX_PROPOSALS)
    .map((entry) => ({
      kind: params.kind,
      title: parseProposalTitle(entry.content, entry.name.replace(/\.md$/i, "")),
      path: toWorkspaceRelativePath(params.workspaceDir, entry.fullPath),
      createdAt: parseProposalCreatedAt(entry.content),
      preview: buildProposalPreview(entry.content),
    }));
}

function buildGeneratedSkillPreview(content: string): string {
  const lines = content
    .split("\n")
    .filter((line) => !line.startsWith("---"))
    .filter((line) => !/^name:\s+/i.test(line))
    .filter((line) => !/^description:\s+/i.test(line))
    .join("\n")
    .trim();
  return trimExcerpt(lines || content);
}

async function loadGeneratedSkillBucket(
  workspaceDir: string,
): Promise<EvolutionDashboardGeneratedSkill[]> {
  const skillsDir = path.join(workspaceDir, "skills");
  let names: string[];
  try {
    names = await fs.readdir(skillsDir);
  } catch {
    return [];
  }
  const files = await Promise.all(
    names
      .filter((name) => name.startsWith("evolution-"))
      .map(async (name) => {
        const fullPath = path.join(skillsDir, name, "SKILL.md");
        try {
          const [stat, content] = await Promise.all([
            fs.stat(fullPath),
            fs.readFile(fullPath, "utf-8"),
          ]);
          const title = content.match(/^#\s+Purpose$/m)?.index != null ? name : name;
          return {
            title,
            fullPath,
            updatedAt: new Date(stat.mtimeMs).toISOString(),
            content,
            name,
            mtimeMs: stat.mtimeMs,
          };
        } catch {
          return null;
        }
      }),
  );
  return files
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .toSorted((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
    .slice(0, MAX_PROPOSALS)
    .map((entry) => ({
      title: entry.title,
      path: toWorkspaceRelativePath(workspaceDir, entry.fullPath),
      updatedAt: entry.updatedAt,
      preview: buildGeneratedSkillPreview(entry.content),
    }));
}

export async function loadEvolutionDashboardSnapshot(
  workspaceDir: string,
): Promise<EvolutionDashboardSnapshot> {
  const [metrics, failures, workflows, generatedSkills, rules, skills] = await Promise.all([
    loadEvolutionMetrics(workspaceDir),
    loadFailureRegistry(workspaceDir),
    loadWorkflowRegistry(workspaceDir),
    loadGeneratedSkillBucket(workspaceDir),
    loadProposalBucket({
      workspaceDir,
      kind: "rule_proposal",
      dirPath: path.join(workspaceDir, RULES_DIR),
    }),
    loadProposalBucket({
      workspaceDir,
      kind: "skill_proposal",
      dirPath: path.join(workspaceDir, SKILLS_DIR),
    }),
  ]);
  const comparison = buildEvolutionComparison(metrics);
  const latestDate = comparison.today?.date;
  const [latestDailyMemory, latestReport] = await Promise.all([
    latestDate
      ? readExcerptFile(workspaceDir, path.join(workspaceDir, "memory", `${latestDate}.md`))
      : Promise.resolve(null),
    latestDate
      ? readExcerptFile(workspaceDir, path.join(workspaceDir, REPORTS_DIR, `${latestDate}.md`))
      : Promise.resolve(null),
  ]);

  return {
    days: metrics.days,
    comparison,
    latestDailyMemory,
    latestReport,
    failures,
    workflows,
    generatedSkills,
    proposals: {
      rules,
      skills,
    },
  };
}
