export const CONTROL_UI_BOOTSTRAP_CONFIG_PATH = "/__openclaw/control-ui-config.json";
export const DEFAULT_GATEWAY_ATTACHMENT_MAX_BYTES = 10_000_000;

export type ControlUiEmbedSandboxMode = "strict" | "scripts" | "trusted";

export type ControlUiBootstrapConfig = {
  basePath: string;
  assistantName: string;
  assistantAvatar: string;
  assistantAgentId: string;
  serverVersion?: string;
  localMediaPreviewRoots?: string[];
  embedSandbox?: ControlUiEmbedSandboxMode;
  allowExternalEmbedUrls?: boolean;
  chatAttachmentMaxBytes?: number;
};
