import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PluginMcpContext } from "./context";

/**
 * Marketplace tools are registered through this seam rather than reusing the
 * parity-driven public MCP registry. PR 6 installs the curated adapters.
 */
export async function registerPluginMarketplaceSurface(
  _server: McpServer,
  _context: PluginMcpContext,
): Promise<void> {
  // Transport/authentication lands independently from tool adapters so each
  // layer can be reviewed and rolled back without affecting the existing MCP.
}
