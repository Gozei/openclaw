import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { DreamingProps } from "./dreaming.ts";
import { renderDreaming } from "./dreaming.ts";
import type { EvolutionProps } from "./evolution.ts";
import { renderEvolution } from "./evolution.ts";

export type MemoryEvolutionTab = "overview" | "dreaming" | "lessons";

export type MemoryEvolutionProps = {
  activeTab: MemoryEvolutionTab;
  dreaming: DreamingProps;
  evolution: EvolutionProps;
  onTabChange: (tab: MemoryEvolutionTab) => void;
};

function renderMetric(label: string, value: number | string, detail?: string) {
  return html`
    <div class="card">
      <div class="muted">${label}</div>
      <div style="font-size: 1.7rem; font-weight: 700; margin-top: 6px;">${value}</div>
      ${detail ? html`<div class="muted" style="margin-top: 6px;">${detail}</div>` : nothing}
    </div>
  `;
}

function renderConceptCard(title: string, body: string) {
  return html`
    <section class="card">
      <div class="card-title">${title}</div>
      <div class="card-sub" style="margin-top: 8px;">${body}</div>
    </section>
  `;
}

function renderOverview(props: MemoryEvolutionProps) {
  const dreaming = props.dreaming;
  const evolution = props.evolution.status;
  const today = evolution?.comparison.today;
  return html`
    <section class="card">
      <div class="card-title">${t("memoryEvolution.title")}</div>
      <div class="card-sub">${t("memoryEvolution.subtitle")}</div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px;">
        <span class="pill ${dreaming.active ? "ok" : "muted"}">
          ${dreaming.active
            ? t("memoryEvolution.health.dreamingOn")
            : t("memoryEvolution.health.dreamingOff")}
        </span>
        <span class="pill ${evolution?.enabled ? "ok" : "muted"}">
          ${evolution?.enabled
            ? t("memoryEvolution.health.evolutionOn")
            : t("memoryEvolution.health.evolutionOff")}
        </span>
      </div>
    </section>

    <div
      style="display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-top: 12px;"
    >
      ${renderMetric(t("memoryEvolution.metrics.shortTerm"), dreaming.shortTermCount)}
      ${renderMetric(t("memoryEvolution.metrics.signals"), dreaming.totalSignalCount)}
      ${renderMetric(t("memoryEvolution.metrics.promoted"), dreaming.promotedCount)}
      ${renderMetric(t("memoryEvolution.metrics.cycles"), today?.cycles ?? 0)}
      ${renderMetric(
        t("memoryEvolution.metrics.reusableWorkflows"),
        evolution?.workflows.length ?? 0,
      )}
      ${renderMetric(
        t("memoryEvolution.metrics.generatedSkills"),
        evolution?.generatedSkills.length ?? 0,
      )}
    </div>

    <div
      style="display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-top: 12px;"
    >
      ${renderConceptCard(
        t("memoryEvolution.dreamingCardTitle"),
        t("memoryEvolution.dreamingCardBody"),
      )}
      ${renderConceptCard(
        t("memoryEvolution.evolutionCardTitle"),
        t("memoryEvolution.evolutionCardBody"),
      )}
      ${renderConceptCard(
        t("memoryEvolution.recallCardTitle"),
        t("memoryEvolution.recallCardBody"),
      )}
    </div>

    <div
      style="display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-top: 12px;"
    >
      <section class="card">
        <div class="card-title">${t("evolutionView.summaryRepeatFailuresTitle")}</div>
        ${evolution?.failures.length
          ? html`
              <div style="display: grid; gap: 8px; margin-top: 12px;">
                ${evolution.failures
                  .slice(0, 3)
                  .map(
                    (entry) => html`
                      <div class="muted mono" style="word-break: break-word;">
                        ${entry.signature} · ${entry.count}
                      </div>
                    `,
                  )}
              </div>
            `
          : html`<div class="muted" style="margin-top: 12px;">
              ${t("evolutionView.summaryRepeatFailuresEmpty")}
            </div>`}
      </section>
      <section class="card">
        <div class="card-title">${t("dreaming.diary.title")}</div>
        ${dreaming.dreamDiaryContent
          ? html`<div class="muted mono" style="margin-top: 8px;">${dreaming.dreamDiaryPath}</div>
              <pre style="white-space: pre-wrap; margin-top: 12px;">
${dreaming.dreamDiaryContent.slice(0, 900)}${dreaming.dreamDiaryContent.length > 900
                  ? "\n..."
                  : ""}</pre
              >`
          : html`<div class="muted" style="margin-top: 12px;">
              ${t("dreaming.diary.noDreamsHint")}
            </div>`}
      </section>
    </div>
  `;
}

export function renderMemoryEvolution(props: MemoryEvolutionProps) {
  return html`
    <div style="display: grid; gap: 12px;">
      <nav class="dreams__tabs">
        ${(["overview", "dreaming", "lessons"] as const).map(
          (tab) => html`
            <button
              class="dreams__tab ${props.activeTab === tab ? "dreams__tab--active" : ""}"
              @click=${() => props.onTabChange(tab)}
            >
              ${t(`memoryEvolution.tabs.${tab}`)}
            </button>
          `,
        )}
      </nav>
      ${props.activeTab === "overview"
        ? renderOverview(props)
        : props.activeTab === "dreaming"
          ? renderDreaming(props.dreaming)
          : renderEvolution(props.evolution)}
    </div>
  `;
}
