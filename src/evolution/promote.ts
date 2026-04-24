import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { writeProposal } from "./proposal-store.js";
import { writeGeneratedSkillDraft } from "./skill-drafts.js";
import type {
  ApplyPromotionsResult,
  PromotionCandidate,
  ReflectionEvent,
  StoredProposal,
} from "./types.js";

function formatDateStamp(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

async function appendUniqueSectionLine(params: {
  filePath: string;
  heading: string;
  line: string;
}): Promise<boolean> {
  await fs.mkdir(path.dirname(params.filePath), { recursive: true });
  let existing = "";
  try {
    existing = await fs.readFile(params.filePath, "utf-8");
  } catch {
    existing = "";
  }

  const normalizedLine = params.line.trim();
  if (!normalizedLine) {
    return false;
  }
  if (existing.includes(`- ${normalizedLine}\n`) || existing.endsWith(`- ${normalizedLine}`)) {
    return false;
  }

  let next = existing;
  if (!next.trim()) {
    next = `## ${params.heading}\n\n- ${normalizedLine}\n`;
  } else if (!next.includes(`## ${params.heading}`)) {
    next = `${next.trimEnd()}\n\n## ${params.heading}\n\n- ${normalizedLine}\n`;
  } else {
    next = `${next.trimEnd()}\n- ${normalizedLine}\n`;
  }

  await fs.writeFile(params.filePath, next, "utf-8");
  return true;
}

function buildProposal(params: {
  candidate: PromotionCandidate;
  reflectionEvent: ReflectionEvent;
}): StoredProposal {
  const kind = params.candidate.kind;
  const proposalKind = kind === "rule_proposal" ? "rule_proposal" : "skill_proposal";
  const titleLine = params.candidate.content.split("\n", 1)[0]?.trim() || params.candidate.id;
  const title =
    proposalKind === "rule_proposal"
      ? titleLine.slice(0, 120)
      : titleLine.replace(/^Title:\s*/i, "").slice(0, 120) || params.candidate.id;

  const rationale = [
    "## Rationale",
    "",
    `- Outcome: ${params.reflectionEvent.outcomeSummary}`,
    `- Succeeded: ${params.reflectionEvent.succeeded ? "yes" : "no"}`,
    `- Confidence: ${params.candidate.confidence.toFixed(2)}`,
    `- Repetition Count: ${params.candidate.repetitionCount}`,
    "",
    "## Proposal",
    "",
    params.candidate.content.trim(),
  ].join("\n");

  return {
    id: crypto.createHash("sha256").update(params.candidate.id).digest("hex").slice(0, 12),
    kind: proposalKind,
    title,
    body: rationale,
    createdAt: params.reflectionEvent.createdAt,
    reflectionEventId: params.reflectionEvent.id,
  };
}

export async function applyPromotionCandidates(params: {
  workspaceDir: string;
  candidates: PromotionCandidate[];
  reflectionEvent: ReflectionEvent;
  nowMs?: number;
  autoPromote?: Partial<Record<PromotionCandidate["kind"], boolean>>;
}): Promise<ApplyPromotionsResult> {
  const nowMs = params.nowMs ?? params.reflectionEvent.createdAt;
  const dailyPath = path.join(params.workspaceDir, "memory", `${formatDateStamp(nowMs)}.md`);
  const memoryPath = path.join(params.workspaceDir, "MEMORY.md");
  const userPath = path.join(params.workspaceDir, "USER.md");

  const applied: PromotionCandidate[] = [];
  const rejected: PromotionCandidate[] = [];
  const writtenPaths = new Set<string>();

  for (const candidate of params.candidates) {
    if (!candidate.content.trim()) {
      rejected.push({ ...candidate, status: "rejected" });
      continue;
    }
    if (!(params.autoPromote?.[candidate.kind] ?? true)) {
      rejected.push({ ...candidate, status: "rejected" });
      continue;
    }
    if (candidate.kind === "daily_memory") {
      const wrote = await appendUniqueSectionLine({
        filePath: dailyPath,
        heading: "进化笔记",
        line: candidate.content,
      });
      if (wrote) {
        applied.push({ ...candidate, status: "applied" });
        writtenPaths.add(dailyPath);
      } else {
        rejected.push({ ...candidate, status: "rejected" });
      }
      continue;
    }
    if (candidate.kind === "memory") {
      const wrote = await appendUniqueSectionLine({
        filePath: memoryPath,
        heading: "Learned Facts",
        line: candidate.content,
      });
      if (wrote) {
        applied.push({ ...candidate, status: "applied" });
        writtenPaths.add(memoryPath);
      } else {
        rejected.push({ ...candidate, status: "rejected" });
      }
      continue;
    }
    if (candidate.kind === "user_profile") {
      const wrote = await appendUniqueSectionLine({
        filePath: userPath,
        heading: "Learned Preferences",
        line: candidate.content,
      });
      if (wrote) {
        applied.push({ ...candidate, status: "applied" });
        writtenPaths.add(userPath);
      } else {
        rejected.push({ ...candidate, status: "rejected" });
      }
      continue;
    }
    if (candidate.kind === "rule_proposal" || candidate.kind === "skill_proposal") {
      const proposalPath = await writeProposal(
        params.workspaceDir,
        buildProposal({
          candidate,
          reflectionEvent: params.reflectionEvent,
        }),
      );
      applied.push({ ...candidate, status: "applied" });
      writtenPaths.add(proposalPath);
      if (candidate.kind === "skill_proposal") {
        const generatedSkillPath = await writeGeneratedSkillDraft({
          workspaceDir: params.workspaceDir,
          proposalContent: candidate.content,
          reflectionEvent: params.reflectionEvent,
        });
        if (generatedSkillPath) {
          writtenPaths.add(generatedSkillPath);
        }
      }
      continue;
    }
    rejected.push({ ...candidate, status: "rejected" });
  }

  return {
    applied,
    rejected,
    writtenPaths: [...writtenPaths].toSorted(),
  };
}
