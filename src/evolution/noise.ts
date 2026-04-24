const OPERATIONAL_FAILURE_SUBSTRINGS = [
  "llm request failed",
  "provider rejected the request schema or tool payload",
  "provider returned an invalid streaming response",
  "connection refused by the provider endpoint",
  "network connection was interrupted",
  "dns lookup for the provider endpoint failed",
  "provider endpoint is unreachable from this host",
  "proxy or tunnel configuration blocked the provider request",
  "network connection error",
  "unknown error",
] as const;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function isOperationalFailureNoise(value: string | undefined): boolean {
  const normalized = normalize(value ?? "");
  if (!normalized) {
    return false;
  }
  return OPERATIONAL_FAILURE_SUBSTRINGS.some((fragment) => normalized.includes(fragment));
}

export function filterOperationalFailureNoise(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter((value) => !isOperationalFailureNoise(value));
}
