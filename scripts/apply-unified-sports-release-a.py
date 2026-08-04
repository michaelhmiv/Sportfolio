from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "server/mcp/public-tool-registry.ts"
PACKAGE_JSON = ROOT / "package.json"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label} match, found {count}")
    return text.replace(old, new, 1)


def regex_replace_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.DOTALL)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label} regex match, found {count}")
    return updated


policy = '''const DENIED_PUBLIC_TOOL_NAMES = [
  "get_agent_capabilities",
  "get_agent_profile",
  "update_agent_profile",
  "clear_agent_byok",
  "save_agent_byok",
  "create_agent_thread",
  "list_agent_threads",
  "list_thread_messages",
  "list_thread_research_sources",
  "get_thread_state",
  "send_agent_message",
  "run_hosted_research",
  "review_idle_cash",
  "review_news_impact",
  "review_portfolio_cleanup",
  "review_setup",
  "list_schedule_templates",
  "list_schedules",
  "upsert_schedule",
  "delete_schedule",
  "get_sms_settings",
  "update_sms_settings",
  "start_sms_link",
  "complete_sms_link",
  "get_news_digest",
  "get_news_unread_count",
  "mark_news_read",
] as const;

const DENIED_PUBLIC_TOOL_NAME_SET = new Set<string>(DENIED_PUBLIC_TOOL_NAMES);
const DENIED_PUBLIC_PROMPT_NAME_SET = new Set(["review_setup", "review_idle_cash"]);

export function isApprovedPublicToolName(name: string): boolean {
  return !name.startsWith("mlb_mcp__") && !DENIED_PUBLIC_TOOL_NAME_SET.has(name);
}

export function isApprovedPublicPromptName(name: string): boolean {
  return !DENIED_PUBLIC_PROMPT_NAME_SET.has(name);
}

export function getDeniedPublicToolNames(): string[] {
  return [...DENIED_PUBLIC_TOOL_NAMES];
}
'''
(ROOT / "server/mcp/public-tool-policy.ts").write_text(policy, encoding="utf-8")

registry = REGISTRY.read_text(encoding="utf-8")
registry = replace_once(
    registry,
    'import { z } from "zod";\n',
    'import { z } from "zod";\nimport {\n  getDeniedPublicToolNames,\n  isApprovedPublicPromptName,\n  isApprovedPublicToolName,\n} from "./public-tool-policy";\n',
    "policy import",
)

registry = regex_replace_once(
    registry,
    r'export async function resolveDynamicMlbPublicTools\(\n  deps: Pick<PublicMcpDependencies, "getInternalMlbMcpToolCatalog">,\n\): Promise<ResolvedDynamicMlbPublicTools> \{.*?\n\}\n\nasync function getResolvedDynamicMlbPublicToolsForContext',
    '''export async function resolveDynamicMlbPublicTools(
  _deps: Pick<PublicMcpDependencies, "getInternalMlbMcpToolCatalog">,
): Promise<ResolvedDynamicMlbPublicTools> {
  return {
    tools: [],
    sourceStatus: {
      id: PUBLIC_DYNAMIC_MLB_SOURCE_ID,
      name: `${PUBLIC_DYNAMIC_MLB_SOURCE_NAME} (internal only)`,
      provider: "internal_mlb_mcp",
      available: true,
      toolCount: 0,
      error: null,
    },
  };
}

async function getResolvedDynamicMlbPublicToolsForContext''',
    "dynamic MLB public discovery",
)

registry = replace_once(
    registry,
    '''export function buildPublicToolRegistry(): PublicToolDefinition[] {
  return [...READ_ALIAS_TOOLS, ...CUSTOM_TOOLS];
}''',
    '''export function buildPublicToolRegistry(): PublicToolDefinition[] {
  return [...READ_ALIAS_TOOLS, ...CUSTOM_TOOLS].filter((tool) =>
    isApprovedPublicToolName(tool.name),
  );
}''',
    "public tool registry",
)

registry = replace_once(
    registry,
    '''export function buildPublicPromptRegistry(): PublicPromptDefinition[] {
  return [...PUBLIC_PROMPTS];
}''',
    '''export function buildPublicPromptRegistry(): PublicPromptDefinition[] {
  return PUBLIC_PROMPTS.filter((prompt) => isApprovedPublicPromptName(prompt.name));
}''',
    "public prompt registry",
)

registry = replace_once(
    registry,
    '''  const invalidCapabilityRefs = auditedRoutes
    .flatMap((entry) =>
      (entry.capabilityIds || []).filter((capabilityId) => !knownCapabilityIds.has(capabilityId)),
    )
    .sort();''',
    '''  const invalidCapabilityRefs = auditedRoutes
    .flatMap((entry) =>
      (entry.capabilityIds || []).filter(
        (capabilityId) =>
          isApprovedPublicToolName(capabilityId) && !knownCapabilityIds.has(capabilityId),
      ),
    )
    .sort();''',
    "authenticated route coverage filtering",
)

registry = replace_once(
    registry,
    '''  const expectedToolNames = new Set<string>([
    ...routeBackedToolNames,
    ...PUBLIC_TOOL_ONLY_CAPABILITY_IDS,
  ]);''',
    '''  const expectedToolNames = new Set<string>(
    [...routeBackedToolNames, ...PUBLIC_TOOL_ONLY_CAPABILITY_IDS].filter(
      isApprovedPublicToolName,
    ),
  );''',
    "expected public tool set",
)

registry = replace_once(
    registry,
    '''    excluded: [...PUBLIC_EXCLUDED_CAPABILITIES],
  };
}''',
    '''    excluded: [
      ...PUBLIC_EXCLUDED_CAPABILITIES,
      ...getDeniedPublicToolNames().map(
        (capabilityId) =>
          ({
            capabilityId,
            kind: "excluded",
            status: "excluded",
            domain: "legacy",
            source: "public_tool_policy",
            notes: "Removed from the public MCP and ChatGPT app surface during unified sports-data Release A.",
          }) satisfies PublicExcludedCapability,
      ),
    ],
  };
}''',
    "excluded legacy inventory",
)

REGISTRY.write_text(registry, encoding="utf-8")

audit_script = '''import {
  buildPublicPromptRegistry,
  buildPublicToolRegistry,
  resolveDynamicMlbPublicTools,
} from "../server/mcp/public-tool-registry";
import { getDeniedPublicToolNames } from "../server/mcp/public-tool-policy";

const dynamic = await resolveDynamicMlbPublicTools({
  getInternalMlbMcpToolCatalog: async () => {
    throw new Error("The audit must not invoke provider discovery.");
  },
});

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      publicTools: buildPublicToolRegistry().map((tool) => tool.name),
      publicPrompts: buildPublicPromptRegistry().map((prompt) => prompt.name),
      deniedLegacyTools: getDeniedPublicToolNames(),
      dynamicProviderTools: dynamic.tools.map((tool) => tool.toolName),
      dynamicSource: dynamic.sourceStatus,
    },
    null,
    2,
  ),
);
'''
(ROOT / "scripts/audit-public-tool-policy.ts").write_text(audit_script, encoding="utf-8")

test = '''import { describe, expect, it } from "vitest";
import {
  buildPublicPromptRegistry,
  buildPublicToolRegistry,
  resolveDynamicMlbPublicTools,
} from "./public-tool-registry";
import { getDeniedPublicToolNames, isApprovedPublicToolName } from "./public-tool-policy";

describe("public tool policy", () => {
  it("excludes every retired legacy capability", () => {
    const names = new Set(buildPublicToolRegistry().map((tool) => tool.name));
    for (const denied of getDeniedPublicToolNames()) {
      expect(names.has(denied), denied).toBe(false);
    }
  });

  it("rejects raw provider pass-through names", () => {
    expect(isApprovedPublicToolName("mlb_mcp__get_schedule")).toBe(false);
    expect(
      buildPublicToolRegistry().some((tool) => tool.name.startsWith("mlb_mcp__")),
    ).toBe(false);
  });

  it("keeps staged action finalizers public", () => {
    const names = new Set(buildPublicToolRegistry().map((tool) => tool.name));
    expect(names.has("get_pending_action")).toBe(true);
    expect(names.has("confirm_pending_action")).toBe(true);
    expect(names.has("cancel_pending_action")).toBe(true);
  });

  it("removes retired advisory prompts", () => {
    const names = buildPublicPromptRegistry().map((prompt) => prompt.name);
    expect(names).not.toContain("review_setup");
    expect(names).not.toContain("review_idle_cash");
    expect(names).toContain("find_boost_candidates");
    expect(names).toContain("stage_trade");
  });

  it("keeps the MLB provider internal without calling discovery", async () => {
    let called = false;
    const resolved = await resolveDynamicMlbPublicTools({
      getInternalMlbMcpToolCatalog: async () => {
        called = true;
        return [];
      },
    });

    expect(called).toBe(false);
    expect(resolved.tools).toEqual([]);
    expect(resolved.sourceStatus.available).toBe(true);
    expect(resolved.sourceStatus.toolCount).toBe(0);
    expect(resolved.sourceStatus.name).toContain("internal only");
  });
});
'''
(ROOT / "server/mcp/public-tool-policy.test.ts").write_text(test, encoding="utf-8")

package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
package.setdefault("scripts", {})["public-tools:audit"] = "tsx scripts/audit-public-tool-policy.ts"
PACKAGE_JSON.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

print("Applied unified sports-data Release A public-tool policy patch.")
