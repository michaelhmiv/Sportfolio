import {
  buildPublicMcpToolRegistry,
  evaluateGameplayCapabilityParity,
  getPublicMcpToolFixtures,
} from "../server/mcp/public-tool-registry";

function main() {
  const parity = evaluateGameplayCapabilityParity();
  const fixtures = getPublicMcpToolFixtures();
  const missingFixtures = buildPublicMcpToolRegistry()
    .map((tool) => tool.name)
    .filter((toolName) => !fixtures[toolName]);

  if (!parity.ok || missingFixtures.length > 0) {
    console.error("[mcp:audit] Public MCP surface audit failed.");
    console.error(
      JSON.stringify(
        {
          ...parity,
          missingFixtures,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        toolCount: parity.toolCount,
        promptCount: parity.promptCount,
        resourceCount: parity.resourceCount,
        includedCount: parity.includedCount,
        excludedCount: parity.excludedCount,
      },
      null,
      2,
    ),
  );
}

main();
