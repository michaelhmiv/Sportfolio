from pathlib import Path

path = Path(__file__).resolve().parents[1] / "scripts/mcp-smoke.ts"
text = path.read_text(encoding="utf-8")
old = '''    try {
      await dynamicClient.client.callTool({
        name: "mlb_mcp__get_schedule",
        arguments: { date: "2026-03-28" },
      });
      failures.push({
        toolName: "dynamic_mlb_tool_execution",
        message: "A raw MLB provider tool could still be executed through the public MCP.",
      });
    } catch {
      // Expected: raw provider tools are internal-only and are not registered publicly.
    }
'''
new = '''    try {
      const rawProviderResult = await dynamicClient.client.callTool({
        name: "mlb_mcp__get_schedule",
        arguments: { date: "2026-03-28" },
      });
      if (!rawProviderResult.isError) {
        failures.push({
          toolName: "dynamic_mlb_tool_execution",
          message: "A raw MLB provider tool could still be executed through the public MCP.",
        });
      }
    } catch {
      // Also acceptable: the MCP client rejects the call because the tool is not registered.
    }
'''
if text.count(old) != 1:
    raise RuntimeError("Expected raw provider execution assertion was not found exactly once.")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Updated MCP smoke to require an error result for internal-only provider tools.")
