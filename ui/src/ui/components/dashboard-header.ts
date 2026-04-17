import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { BRAND_NAME } from "../brand.ts";
import { titleForTab, type Tab } from "../navigation.js";
import { agentLogoUrl } from "../views/agents-utils.ts";

export class DashboardHeader extends LitElement {
  override createRenderRoot() {
    return this;
  }

  @property() tab: Tab = "overview";
  @property() basePath = "";

  override render() {
    const label = titleForTab(this.tab);
    const logoUrl = agentLogoUrl(this.basePath);

    return html`
      <div class="dashboard-header">
        <div class="dashboard-header__breadcrumb">
          <span
            class="dashboard-header__breadcrumb-link dashboard-header__brand-link"
            @click=${() =>
              this.dispatchEvent(
                new CustomEvent("navigate", { detail: "overview", bubbles: true, composed: true }),
              )}
          >
            <img class="dashboard-header__brand-logo" src=${logoUrl} alt=${BRAND_NAME} />
            <span>${BRAND_NAME}</span>
          </span>
          <span class="dashboard-header__breadcrumb-sep">›</span>
          <span class="dashboard-header__breadcrumb-current">${label}</span>
        </div>
        <div class="dashboard-header__actions">
          <slot></slot>
        </div>
      </div>
    `;
  }
}

if (!customElements.get("dashboard-header")) {
  customElements.define("dashboard-header", DashboardHeader);
}
