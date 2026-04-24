import { DEFAULT_PROVIDER } from "../../agents/defaults.js";
import type { ModelCatalogEntry } from "../../agents/model-catalog.js";
import { buildAllowedModelSet, buildConfiguredModelCatalog } from "../../agents/model-selection.js";
import { loadConfig } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function modelCatalogKey(entry: Pick<ModelCatalogEntry, "provider" | "id">): string {
  return `${entry.provider.trim().toLowerCase()}::${entry.id.trim().toLowerCase()}`;
}

function buildPickerCatalog(params: {
  catalog: ModelCatalogEntry[];
  allowlistedCatalog: ModelCatalogEntry[];
  configuredCatalog: ModelCatalogEntry[];
}): ModelCatalogEntry[] {
  const configuredOrAllowed =
    params.allowlistedCatalog.length > 0 ? params.allowlistedCatalog : params.configuredCatalog;
  if (configuredOrAllowed.length === 0) {
    return params.catalog;
  }
  const runtimeByKey = new Map(params.catalog.map((entry) => [modelCatalogKey(entry), entry]));
  const seen = new Set<string>();
  return configuredOrAllowed
    .filter((entry) => {
      const key = modelCatalogKey(entry);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((entry) => runtimeByKey.get(modelCatalogKey(entry)) ?? entry);
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
      const { allowAny, allowedCatalog } = buildAllowedModelSet({
        cfg,
        catalog,
        defaultProvider: DEFAULT_PROVIDER,
      });
      const configuredOnly = params?.configuredOnly === true;
      const configuredCatalog = configuredOnly ? buildConfiguredModelCatalog({ cfg }) : [];
      const allowlistedCatalog = allowAny ? [] : allowedCatalog;
      const models = configuredOnly
        ? buildPickerCatalog({
            catalog,
            allowlistedCatalog,
            configuredCatalog,
          })
        : allowedCatalog.length > 0
          ? allowedCatalog
          : catalog;
      respond(true, { models }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
