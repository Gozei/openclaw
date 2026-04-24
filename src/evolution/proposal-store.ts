import fs from "node:fs/promises";
import path from "node:path";
import type { StoredProposal } from "./types.js";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function resolveProposalDir(workspaceDir: string, kind: StoredProposal["kind"]): string {
  const bucket = kind === "rule_proposal" ? "rules" : "skills";
  return path.join(workspaceDir, "memory", ".evolution", "proposals", bucket);
}

export function resolveProposalPath(workspaceDir: string, proposal: StoredProposal): string {
  const slug = slugify(proposal.title) || proposal.id;
  return path.join(resolveProposalDir(workspaceDir, proposal.kind), `${slug}-${proposal.id}.md`);
}

function formatProposal(proposal: StoredProposal): string {
  const heading = proposal.kind === "rule_proposal" ? "Rule Proposal" : "Skill Proposal";
  return [
    `# ${heading}: ${proposal.title}`,
    "",
    `Created At: ${new Date(proposal.createdAt).toISOString()}`,
    `Reflection Event: ${proposal.reflectionEventId}`,
    "",
    proposal.body.trim(),
    "",
  ].join("\n");
}

export async function writeProposal(
  workspaceDir: string,
  proposal: StoredProposal,
): Promise<string> {
  const filePath = resolveProposalPath(workspaceDir, proposal);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, formatProposal(proposal), "utf-8");
  return filePath;
}
