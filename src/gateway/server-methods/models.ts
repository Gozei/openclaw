import { DEFAULT_PROVIDER } from "../../agents/defaults.js";
import type { ModelCatalogEntry } from "../../agents/model-catalog.js";
import {
  buildAllowedModelSet,
  buildConfiguredModelCatalog,
  modelKey,
} from "../../agents/model-selection.js";
import { loadConfig } from "../../config/config.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function selectModelsForChatPicker(params: {
  cfg: OpenClawConfig;
  catalog: ModelCatalogEntry[];
}): ModelCatalogEntry[] {
  const { allowAny, allowedCatalog } = buildAllowedModelSet({
    cfg: params.cfg,
    catalog: params.catalog,
    defaultProvider: DEFAULT_PROVIDER,
  });
  if (!allowAny && allowedCatalog.length > 0) {
    return allowedCatalog;
  }

  const configuredKeys = new Set(
    buildConfiguredModelCatalog({ cfg: params.cfg }).map((entry) =>
      modelKey(entry.provider, entry.id),
    ),
  );
  if (configuredKeys.size === 0) {
    return [];
  }

  return allowedCatalog.filter((entry) => configuredKeys.has(modelKey(entry.provider, entry.id)));
}

export const modelsHandlers: GatewayRequestHandlers = {
  "models.list": async ({ params, respond, context }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const catalog = await context.loadGatewayModelCatalog();
      const cfg = loadConfig();
      const models = selectModelsForChatPicker({ cfg, catalog });
      respond(true, { models }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
