import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { EvolutionStatus } from "../controllers/evolution.ts";

export type EvolutionProps = {
  loading: boolean;
  error: string | null;
  status: EvolutionStatus | null;
  onRefresh: () => void;
};

function formatDateTime(value: number | string | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toLocaleString();
  }
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
  }
  return "—";
}

function renderMetricCard(label: string, value: number, detail?: string) {
  return html`
    <div class="card">
      <div class="muted">${label}</div>
      <div style="font-size: 1.8rem; font-weight: 700; margin-top: 6px;">${value}</div>
      ${detail ? html`<div class="muted" style="margin-top: 6px;">${detail}</div>` : nothing}
    </div>
  `;
}

function renderExcerptCard(title: string, excerpt: { path: string; content: string } | null) {
  return html`
    <section class="card">
      <div class="card-title">${title}</div>
      ${excerpt
        ? html`
            <div class="muted mono" style="margin-top: 8px;">${excerpt.path}</div>
            <pre style="white-space: pre-wrap; margin-top: 12px;">${excerpt.content}</pre>
          `
        : html`<div class="muted" style="margin-top: 12px;">${t("evolutionView.noDataYet")}</div>`}
    </section>
  `;
}

function renderFailureList(status: EvolutionStatus) {
  const topFailures = status.failures.slice(0, 6);
  return html`
    <section class="card">
      <div class="card-title">${t("evolutionView.summaryRepeatFailuresTitle")}</div>
      ${topFailures.length === 0
        ? html`<div class="muted" style="margin-top: 12px;">
            ${t("evolutionView.summaryRepeatFailuresEmpty")}
          </div>`
        : html`
            <div style="display: grid; gap: 10px; margin-top: 12px;">
              ${topFailures.map(
                (entry) => html`
                  <div
                    style="border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px;"
                  >
                    <div class="mono" style="font-size: 12px; word-break: break-word;">
                      ${entry.signature}
                    </div>
                    <div style="margin-top: 6px;">
                      ${t("evolutionView.count", { count: String(entry.count) })}
                    </div>
                    <div class="muted" style="margin-top: 4px;">
                      ${t("evolutionView.lastSeen", { time: formatDateTime(entry.lastSeenAt) })}
                    </div>
                    ${entry.lastWorkaround
                      ? html`<div class="muted" style="margin-top: 4px;">
                          ${t("evolutionView.workaround", { text: entry.lastWorkaround })}
                        </div>`
                      : nothing}
                  </div>
                `,
              )}
            </div>
          `}
    </section>
  `;
}

function renderWorkflowList(status: EvolutionStatus) {
  const topWorkflows = status.workflows.slice(0, 6);
  return html`
    <section class="card">
      <div class="card-title">${t("evolutionView.summaryReusableWorkflowsTitle")}</div>
      ${topWorkflows.length === 0
        ? html`<div class="muted" style="margin-top: 12px;">
            ${t("evolutionView.summaryReusableWorkflowsEmpty")}
          </div>`
        : html`
            <div style="display: grid; gap: 10px; margin-top: 12px;">
              ${topWorkflows.map(
                (entry) => html`
                  <div
                    style="border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px;"
                  >
                    <div style="font-weight: 600; word-break: break-word;">
                      ${entry.title || entry.key}
                    </div>
                    ${entry.trigger
                      ? html`<div class="muted" style="margin-top: 4px;">${entry.trigger}</div>`
                      : nothing}
                    <div style="margin-top: 6px;">
                      ${t("evolutionView.count", { count: String(entry.count) })}
                    </div>
                    <div class="muted" style="margin-top: 4px;">
                      ${t("evolutionView.lastSeen", { time: formatDateTime(entry.lastSeenAt) })}
                    </div>
                    ${entry.steps?.[0]
                      ? html`<div class="muted" style="margin-top: 8px;">
                          Start with: ${entry.steps[0]}
                        </div>`
                      : nothing}
                    ${entry.successCriteria?.[0]
                      ? html`<div class="muted" style="margin-top: 4px;">
                          Success cue: ${entry.successCriteria[0]}
                        </div>`
                      : nothing}
                    ${entry.lastSummary
                      ? html`<pre style="white-space: pre-wrap; margin-top: 10px;">
${entry.lastSummary}</pre
                        >`
                      : nothing}
                  </div>
                `,
              )}
            </div>
          `}
    </section>
  `;
}

function renderProposalBucket(title: string, items: EvolutionStatus["proposals"]["rules"]) {
  return html`
    <section class="card">
      <div class="card-title">${title}</div>
      ${items.length === 0
        ? html`<div class="muted" style="margin-top: 12px;">
            ${t("evolutionView.noProposalsYet")}
          </div>`
        : html`
            <div style="display: grid; gap: 10px; margin-top: 12px;">
              ${items.map(
                (item) => html`
                  <details
                    style="border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px;"
                  >
                    <summary style="cursor: pointer; font-weight: 600;">${item.title}</summary>
                    <div class="muted mono" style="margin-top: 8px;">${item.path}</div>
                    ${item.createdAt
                      ? html`<div class="muted" style="margin-top: 4px;">
                          ${t("evolutionView.created", { time: formatDateTime(item.createdAt) })}
                        </div>`
                      : nothing}
                    <pre style="white-space: pre-wrap; margin-top: 12px;">${item.preview}</pre>
                  </details>
                `,
              )}
            </div>
          `}
    </section>
  `;
}

function renderGeneratedSkills(status: EvolutionStatus) {
  const items = status.generatedSkills.slice(0, 6);
  return html`
    <section class="card">
      <div class="card-title">Generated Skills</div>
      ${items.length === 0
        ? html`<div class="muted" style="margin-top: 12px;">No generated skills yet.</div>`
        : html`
            <div style="display: grid; gap: 10px; margin-top: 12px;">
              ${items.map(
                (item) => html`
                  <details
                    style="border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px;"
                  >
                    <summary style="cursor: pointer; font-weight: 600;">${item.title}</summary>
                    <div class="muted mono" style="margin-top: 8px;">${item.path}</div>
                    ${item.updatedAt
                      ? html`<div class="muted" style="margin-top: 4px;">
                          Updated: ${formatDateTime(item.updatedAt)}
                        </div>`
                      : nothing}
                    <pre style="white-space: pre-wrap; margin-top: 12px;">${item.preview}</pre>
                  </details>
                `,
              )}
            </div>
          `}
    </section>
  `;
}

export function renderEvolution(props: EvolutionProps) {
  const status = props.status;
  const today = status?.comparison.today;
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; gap: 12px; align-items: flex-start;">
        <div>
          <div class="card-title">${t("evolutionView.title")}</div>
          <div class="card-sub">${t("evolutionView.subtitle")}</div>
          ${status?.workspaceDir
            ? html`<div class="muted mono" style="margin-top: 8px;">
                ${t("evolutionView.workspace", { path: status.workspaceDir })}
              </div>`
            : nothing}
        </div>
        <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? t("common.refreshing") : t("common.refresh")}
        </button>
      </div>
      ${props.error
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
        : nothing}
      ${status
        ? html`
            <div class="callout ${status.enabled ? "info" : "warning"}" style="margin-top: 12px;">
              ${status.enabled ? t("evolutionView.enabledHint") : t("evolutionView.disabledHint")}
            </div>
            ${status.comparison.summary.length > 0
              ? html`
                  <div style="display: grid; gap: 8px; margin-top: 12px;">
                    ${status.comparison.summary.map(
                      (line) => html`<div class="muted">${line}</div>`,
                    )}
                  </div>
                `
              : nothing}
          `
        : html`
            <div class="callout info" style="margin-top: 12px;">
              ${t("evolutionView.emptyHint")}
            </div>
          `}
    </section>

    ${status
      ? html`
          <div
            style="display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-top: 12px;"
          >
            ${renderMetricCard(t("evolutionView.cycles"), today?.cycles ?? 0)}
            ${renderMetricCard(t("evolutionView.successes"), today?.successes ?? 0)}
            ${renderMetricCard(t("evolutionView.failures"), today?.failures ?? 0)}
            ${renderMetricCard(t("evolutionView.repeatedFailures"), today?.repeatedFailures ?? 0)}
            ${renderMetricCard(
              t("evolutionView.appliedRules"),
              today?.appliedByKind.rule_proposal ?? 0,
              t("evolutionView.candidates", {
                count: String(today?.candidatesByKind.rule_proposal ?? 0),
              }),
            )}
            ${renderMetricCard(
              t("evolutionView.appliedSkills"),
              today?.appliedByKind.skill_proposal ?? 0,
              t("evolutionView.candidates", {
                count: String(today?.candidatesByKind.skill_proposal ?? 0),
              }),
            )}
            ${renderMetricCard("Generated Skills", status.generatedSkills.length)}
          </div>

          <div
            style="display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-top: 12px;"
          >
            ${renderExcerptCard(t("evolutionView.latestDailyMemory"), status.latestDailyMemory)}
            ${renderExcerptCard(t("evolutionView.latestReport"), status.latestReport)}
          </div>

          <div
            style="display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-top: 12px;"
          >
            ${renderFailureList(status)} ${renderWorkflowList(status)}
          </div>

          <div
            style="display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-top: 12px;"
          >
            ${renderGeneratedSkills(status)}
          </div>

          <div
            style="display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-top: 12px;"
          >
            ${renderProposalBucket(t("evolutionView.ruleProposals"), status.proposals.rules)}
            ${renderProposalBucket(t("evolutionView.skillProposals"), status.proposals.skills)}
          </div>
        `
      : nothing}
  `;
}
