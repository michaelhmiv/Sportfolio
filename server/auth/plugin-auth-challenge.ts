import type { PluginOAuthConfig } from "./plugin-oauth-config";

export function pluginResourceMetadataUrl(config: PluginOAuthConfig): string {
  return `${new URL(config.resource).origin}/.well-known/oauth-protected-resource`;
}

export function buildPluginWwwAuthenticate(
  config: PluginOAuthConfig,
  options: { error?: string; description?: string; scope?: string } = {},
): string {
  const parts = [`resource_metadata="${pluginResourceMetadataUrl(config)}"`];
  const scope = options.scope || config.requiredScopes.join(" ");
  if (scope) parts.push(`scope="${scope.replace(/"/g, "")}"`);
  if (options.error) parts.push(`error="${options.error.replace(/"/g, "")}"`);
  if (options.description) {
    parts.push(`error_description="${options.description.replace(/["\r\n]/g, " ")}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}

export function pluginMcpAuthError(
  config: PluginOAuthConfig,
  options: { error?: string; description?: string; scope?: string } = {},
) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: options.description || "Connect your Sportfolio account to continue.",
      },
    ],
    _meta: {
      "mcp/www_authenticate": [buildPluginWwwAuthenticate(config, options)],
    },
  };
}
