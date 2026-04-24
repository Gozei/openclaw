import type { GatewayBrowserClient } from "../gateway.ts";
import type { ModelCatalogEntry } from "../types.ts";

/**
 * Fetch the model catalog from the gateway.
 *
 * Accepts a {@link GatewayBrowserClient} (matching the existing ui/ controller
 * convention).  Returns an array of {@link ModelCatalogEntry}; on failure the
 * caller receives an empty array rather than throwing.
 */
export async function loadModels(
  client: GatewayBrowserClient,
  opts?: { configuredOnly?: boolean },
): Promise<ModelCatalogEntry[]> {
  try {
    const result = await client.request<{ models: ModelCatalogEntry[] }>(
      "models.list",
      opts?.configuredOnly === true ? { configuredOnly: true } : {},
    );
    return result?.models ?? [];
  } catch {
    return [];
  }
}
