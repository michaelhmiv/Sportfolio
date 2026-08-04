from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]

policy = {
    "schemaVersion": 1,
    "owner": "michaelhmiv",
    "scanPaths": [
        "server/mcp/public-tool-registry.ts",
        "server/mcp/plugin/registry.ts",
        "server/mcp/plugin/ui",
        "server/routes/mcp.ts",
        "server/routes/plugin-mcp.ts",
        "server/scheduler.ts",
        "server/jobs/job-registry.ts",
        "client/src",
        "dist/index.js",
        "dist/public",
    ],
    "patterns": [
        {"id": "raw-provider-prefix", "regex": "mlb_mcp__"},
        {"id": "hosted-research", "regex": "run_hosted_research|review_news_impact"},
        {"id": "digest", "regex": "get_news_digest|get_news_unread_count|mark_news_read|compileUserDigest"},
        {"id": "sms", "regex": "get_sms_settings|start_sms_link|complete_sms_link|update_sms_settings|sms-link"},
        {"id": "agent-thread", "regex": "get_agent_profile|get_agent_capabilities|list_agent_threads|create_agent_thread|send_agent_message|list_thread_messages|list_thread_research_sources"},
        {"id": "advisory-schedule", "regex": "list_schedules|list_schedule_templates|upsert_schedule|delete_schedule|daily_setup_review"},
        {"id": "hermes", "regex": "Hermes|runHermes"},
    ],
    "exceptions": [
        {
            "patternIds": ["raw-provider-prefix", "hosted-research", "digest", "sms", "agent-thread", "advisory-schedule", "hermes"],
            "pathRegex": "^(server/mcp/public-tool-registry\\.ts|server/mcp/plugin/registry\\.ts|server/routes/mcp\\.ts|dist/index\\.js)$",
            "owner": "michaelhmiv",
            "expiresOn": "2026-09-30",
            "reason": "Legacy server-only implementation remains during the gated cleanup and standalone MLB retirement sequence; public capability snapshots and client builds must remain clean.",
            "maxMatches": 5000,
        }
    ],
}
(ROOT / "config").mkdir(exist_ok=True)
(ROOT / "config/public-capability-governance.json").write_text(json.dumps(policy, indent=2) + "\n")

governance = r'''import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { buildPluginCatalog } from "../server/mcp/plugin/catalog";
import { buildPluginPresentationCatalog, SPORTFOLIO_UI_RESOURCE_URIS } from "../server/mcp/plugin/ui/surface";
import { buildPublicCapabilityInventory, buildPublicPromptRegistry } from "../server/mcp/public-tool-registry";

export type SnapshotEntry = {
  kind: "tool" | "prompt" | "resource";
  name: string;
  auth: "public" | "oauth";
  readOnly: boolean | null;
  destructive: boolean | null;
  openWorld: boolean | null;
  outputSchema: string | null;
  resourceUri: string | null;
  domain: string;
  sportClassification: "none" | "mlb" | "nhl" | "nascar" | "multi_sport";
  source: string;
};
export type CapabilitySnapshot = { schemaVersion: 1; entries: SnapshotEntry[] };
export type SnapshotDiff = {
  added: SnapshotEntry[];
  removed: SnapshotEntry[];
  changed: Array<{ name: string; kind: string; before: SnapshotEntry; after: SnapshotEntry; fields: string[] }>;
  authDowngrades: string[];
  missingOutputSchemas: string[];
  unsafeNames: string[];
};

type GovernancePolicy = {
  schemaVersion: 1;
  owner: string;
  scanPaths: string[];
  patterns: Array<{ id: string; regex: string }>;
  exceptions: Array<{
    patternIds: string[];
    pathRegex: string;
    owner: string;
    expiresOn: string;
    reason: string;
    maxMatches: number;
  }>;
};
export type ScanFinding = { patternId: string; path: string; line: number; match: string; excepted: boolean; exceptionReason?: string };

const ROOT = resolve(import.meta.dirname, "..");
const SNAPSHOT_PATH = resolve(ROOT, "config/public-capability-snapshot.json");
const POLICY_PATH = resolve(ROOT, "config/public-capability-governance.json");
const RETIRED_NAME = /^(mlb_mcp__|run_hosted_research$|review_news_impact$|get_news_digest$|get_news_unread_count$|mark_news_read$|get_sms_settings$|start_sms_link$|complete_sms_link$|update_sms_settings$|get_agent_profile$|get_agent_capabilities$|list_agent_threads$|create_agent_thread$|send_agent_message$|list_thread_messages$|list_thread_research_sources$|list_schedules$|list_schedule_templates$|upsert_schedule$|delete_schedule$)/i;

function sportClassification(domain: string, name: string): SnapshotEntry["sportClassification"] {
  const normalized = domain.toLowerCase();
  if (normalized === "sports_data" || name.includes("sports_") || name.includes("event_")) return "multi_sport";
  if (["mlb", "nhl", "nascar"].includes(normalized)) return normalized as "mlb" | "nhl" | "nascar";
  return "none";
}

export function buildCurrentCapabilitySnapshot(): CapabilitySnapshot {
  const tools: SnapshotEntry[] = buildPluginCatalog().map((tool) => ({
    kind: "tool",
    name: tool.name,
    auth: tool.access === "public" ? "public" : "oauth",
    readOnly: tool.annotations.readOnlyHint,
    destructive: tool.annotations.destructiveHint,
    openWorld: tool.annotations.openWorldHint,
    outputSchema: "plugin-envelope-v1",
    resourceUri: null,
    domain: tool.domain,
    sportClassification: sportClassification(tool.domain, tool.name),
    source: tool.source,
  }));
  const presentations: SnapshotEntry[] = buildPluginPresentationCatalog().map((tool) => ({
    kind: "tool",
    name: tool.name,
    auth: tool.access === "public" ? "public" : "oauth",
    readOnly: true,
    destructive: false,
    openWorld: false,
    outputSchema: "plugin-presentation-v1",
    resourceUri: tool.resourceUri,
    domain: "plugin_ui",
    sportClassification: "none",
    source: "plugin_ui:presentation",
  }));
  const prompts: SnapshotEntry[] = buildPublicPromptRegistry().map((prompt) => ({
    kind: "prompt",
    name: prompt.name,
    auth: "public",
    readOnly: null,
    destructive: null,
    openWorld: null,
    outputSchema: null,
    resourceUri: null,
    domain: "prompts",
    sportClassification: "none",
    source: "public_registry:prompt",
  }));
  const inventory = buildPublicCapabilityInventory();
  const resources: SnapshotEntry[] = inventory.included
    .filter((entry) => entry.kind === "resource" && entry.resourceUri)
    .map((entry) => ({
      kind: "resource",
      name: entry.resourceUri!,
      auth: "public",
      readOnly: null,
      destructive: null,
      openWorld: null,
      outputSchema: null,
      resourceUri: entry.resourceUri!,
      domain: entry.domain,
      sportClassification: "none",
      source: entry.source,
    }));
  for (const uri of Object.values(SPORTFOLIO_UI_RESOURCE_URIS)) {
    resources.push({
      kind: "resource",
      name: uri,
      auth: "public",
      readOnly: null,
      destructive: null,
      openWorld: null,
      outputSchema: null,
      resourceUri: uri,
      domain: "plugin_ui",
      sportClassification: "none",
      source: "plugin_ui:resource",
    });
  }
  return {
    schemaVersion: 1,
    entries: [...tools, ...presentations, ...prompts, ...resources].sort((a, b) =>
      `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`),
    ),
  };
}

function key(entry: SnapshotEntry) { return `${entry.kind}:${entry.name}`; }
export function compareCapabilitySnapshots(before: CapabilitySnapshot, after: CapabilitySnapshot): SnapshotDiff {
  const oldMap = new Map(before.entries.map((entry) => [key(entry), entry]));
  const newMap = new Map(after.entries.map((entry) => [key(entry), entry]));
  const added = [...newMap].filter(([name]) => !oldMap.has(name)).map(([, value]) => value);
  const removed = [...oldMap].filter(([name]) => !newMap.has(name)).map(([, value]) => value);
  const changed: SnapshotDiff["changed"] = [];
  for (const [entryKey, oldEntry] of oldMap) {
    const next = newMap.get(entryKey);
    if (!next) continue;
    const fields = Object.keys(oldEntry).filter(
      (field) => JSON.stringify(oldEntry[field as keyof SnapshotEntry]) !== JSON.stringify(next[field as keyof SnapshotEntry]),
    );
    if (fields.length) changed.push({ name: oldEntry.name, kind: oldEntry.kind, before: oldEntry, after: next, fields });
  }
  const authDowngrades = changed
    .filter((change) => change.before.auth === "oauth" && change.after.auth === "public")
    .map((change) => `${change.kind}:${change.name}`);
  const missingOutputSchemas = after.entries
    .filter((entry) => entry.kind === "tool" && !entry.outputSchema)
    .map((entry) => entry.name);
  const unsafeNames = after.entries.filter((entry) => RETIRED_NAME.test(entry.name)).map((entry) => entry.name);
  return { added, removed, changed, authDowngrades, missingOutputSchemas, unsafeNames };
}

export function formatSnapshotDiff(diff: SnapshotDiff): string {
  const lines = ["Public capability snapshot diff:"];
  lines.push(`  Added: ${diff.added.length ? diff.added.map(key).join(", ") : "none"}`);
  lines.push(`  Removed: ${diff.removed.length ? diff.removed.map(key).join(", ") : "none"}`);
  lines.push(`  Changed: ${diff.changed.length ? diff.changed.map((item) => `${item.kind}:${item.name}[${item.fields.join(",")}]`).join(", ") : "none"}`);
  if (diff.authDowngrades.length) lines.push(`  AUTH DOWNGRADES: ${diff.authDowngrades.join(", ")}`);
  if (diff.missingOutputSchemas.length) lines.push(`  MISSING OUTPUT SCHEMAS: ${diff.missingOutputSchemas.join(", ")}`);
  if (diff.unsafeNames.length) lines.push(`  RETIRED/RAW CAPABILITIES: ${diff.unsafeNames.join(", ")}`);
  return lines.join("\n");
}

function listFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((entry) => listFiles(resolve(path, entry)));
}

export function scanCapabilitySurfaces(
  policy: GovernancePolicy,
  root = ROOT,
  now = new Date(),
): { findings: ScanFinding[]; violations: ScanFinding[]; expiredExceptions: string[] } {
  const expiredExceptions = policy.exceptions
    .filter((exception) => !exception.owner || !exception.reason || new Date(`${exception.expiresOn}T23:59:59.999Z`) < now)
    .map((exception) => `${exception.owner || "unowned"}:${exception.pathRegex}:${exception.expiresOn}`);
  const exceptionCounts = new Map<number, number>();
  const findings: ScanFinding[] = [];
  for (const configuredPath of policy.scanPaths) {
    for (const absolute of listFiles(resolve(root, configuredPath))) {
      if (!/\.(?:ts|tsx|js|jsx|mjs|cjs|json|html|txt|map)$/.test(absolute)) continue;
      const path = relative(root, absolute).replaceAll("\\", "/");
      const content = readFileSync(absolute, "utf8");
      for (const pattern of policy.patterns) {
        const regex = new RegExp(pattern.regex, "gi");
        for (const match of content.matchAll(regex)) {
          const line = content.slice(0, match.index || 0).split("\n").length;
          const exceptionIndex = policy.exceptions.findIndex(
            (exception) =>
              exception.patternIds.includes(pattern.id) &&
              new RegExp(exception.pathRegex).test(path) &&
              new Date(`${exception.expiresOn}T23:59:59.999Z`) >= now,
          );
          const excepted = exceptionIndex >= 0;
          if (excepted) exceptionCounts.set(exceptionIndex, (exceptionCounts.get(exceptionIndex) || 0) + 1);
          findings.push({
            patternId: pattern.id,
            path,
            line,
            match: match[0],
            excepted,
            exceptionReason: excepted ? policy.exceptions[exceptionIndex].reason : undefined,
          });
        }
      }
    }
  }
  const violations = findings.filter((finding) => !finding.excepted);
  policy.exceptions.forEach((exception, index) => {
    if ((exceptionCounts.get(index) || 0) > exception.maxMatches) {
      violations.push({
        patternId: "exception-budget",
        path: exception.pathRegex,
        line: 0,
        match: `${exceptionCounts.get(index)} > ${exception.maxMatches}`,
        excepted: false,
      });
    }
  });
  return { findings, violations, expiredExceptions };
}

function loadPolicy(): GovernancePolicy {
  return JSON.parse(readFileSync(POLICY_PATH, "utf8")) as GovernancePolicy;
}

export function runGovernanceCheck() {
  const current = buildCurrentCapabilitySnapshot();
  if (!existsSync(SNAPSHOT_PATH)) throw new Error("Capability baseline is missing. Run npm run governance:capabilities:update and review the diff.");
  const baseline = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as CapabilitySnapshot;
  const diff = compareCapabilitySnapshots(baseline, current);
  console.log(formatSnapshotDiff(diff));
  if (diff.added.length || diff.removed.length || diff.changed.length || diff.authDowngrades.length || diff.missingOutputSchemas.length || diff.unsafeNames.length) {
    throw new Error("Public capability snapshot changed. Update the reviewed baseline explicitly; environment bypasses are unsupported.");
  }
  const scan = scanCapabilitySurfaces(loadPolicy());
  if (scan.expiredExceptions.length) throw new Error(`Expired or invalid capability exceptions: ${scan.expiredExceptions.join(", ")}`);
  if (scan.violations.length) {
    throw new Error(`Retired capability surface violations:\n${scan.violations.map((finding) => `${finding.patternId} ${finding.path}:${finding.line} ${finding.match}`).join("\n")}`);
  }
  console.log(`Capability governance passed: ${current.entries.length} entries, ${scan.findings.length} owned exception match(es), no unapproved surfaces.`);
}

function main() {
  const command = process.argv[2] || "check";
  if (command === "snapshot") {
    process.stdout.write(`${JSON.stringify(buildCurrentCapabilitySnapshot(), null, 2)}\n`);
    return;
  }
  if (command === "update") {
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(buildCurrentCapabilitySnapshot(), null, 2)}\n`);
    console.log(`Updated ${relative(ROOT, SNAPSHOT_PATH)}. Review and commit this baseline intentionally.`);
    return;
  }
  runGovernanceCheck();
}

if (process.argv[1]?.endsWith("public-capability-governance.ts")) main();
'''
(ROOT / "scripts/public-capability-governance.ts").write_text(governance)

# Create the initial baseline from the same checked-in sources. The deterministic CI self-test will
# reject any mismatch between this generated artifact and the runtime catalog.
submission = json.loads((ROOT / "chatgpt-app-submission.json").read_text())
registry_source = (ROOT / "server/mcp/public-tool-registry.ts").read_text()
plugin_source = (ROOT / "server/mcp/plugin/registry.ts").read_text()
ui_source = (ROOT / "server/mcp/plugin/ui/surface.ts").read_text()
noauth_match = re.search(r"const PUBLIC_NOAUTH_TOOL_NAMES = new Set\(\[(.*?)\]\);", plugin_source, re.S)
noauth = set(re.findall(r'"([^"]+)"', noauth_match.group(1) if noauth_match else ""))
domain_by_name = {}
for block in registry_source.split("defineTool({")[1:]:
    name_match = re.search(r'name:\s*"([^"]+)"', block)
    domain_match = re.search(r'domain:\s*"([^"]+)"', block)
    if name_match and domain_match:
        domain_by_name.setdefault(name_match.group(1), domain_match.group(1))

def classify(domain, name):
    if domain == "sports_data" or "sports_" in name or "event_" in name:
        return "multi_sport"
    if domain in {"mlb", "nhl", "nascar"}:
        return domain
    return "none"

entries = []
for name, value in submission["tools"].items():
    annotations = value["annotations"]
    domain = domain_by_name.get(name, "unknown")
    entries.append({
        "kind": "tool",
        "name": name,
        "auth": "public" if name in noauth else "oauth",
        "readOnly": annotations["readOnlyHint"],
        "destructive": annotations["destructiveHint"],
        "openWorld": annotations["openWorldHint"],
        "outputSchema": "plugin-envelope-v1",
        "resourceUri": None,
        "domain": domain,
        "sportClassification": classify(domain, name),
        "source": "public_registry:tool",
    })

uri_values = dict(re.findall(r'(\w+):\s*"(ui://[^"]+)"', ui_source.split("} as const", 1)[0]))
for block in ui_source.split("const PRESENTATION_DEFINITIONS", 1)[1].split("];", 1)[0].split("  {")[1:]:
    name_match = re.search(r'name:\s*"([^"]+)"', block)
    access_match = re.search(r'access:\s*"([^"]+)"', block)
    uri_match = re.search(r'resourceUri:\s*SPORTFOLIO_UI_RESOURCE_URIS\.(\w+)', block)
    if not (name_match and access_match and uri_match):
        continue
    name = name_match.group(1)
    uri = uri_values[uri_match.group(1)]
    entries.append({
        "kind": "tool",
        "name": name,
        "auth": access_match.group(1),
        "readOnly": True,
        "destructive": False,
        "openWorld": False,
        "outputSchema": "plugin-presentation-v1",
        "resourceUri": uri,
        "domain": "plugin_ui",
        "sportClassification": "none",
        "source": "plugin_ui:presentation",
    })

prompt_section = registry_source.split("const PUBLIC_PROMPTS", 1)[1].split("];", 1)[0]
for name in sorted(set(re.findall(r'name:\s*"([^"]+)"', prompt_section))):
    entries.append({"kind":"prompt","name":name,"auth":"public","readOnly":None,"destructive":None,"openWorld":None,"outputSchema":None,"resourceUri":None,"domain":"prompts","sportClassification":"none","source":"public_registry:prompt"})
resource_section = registry_source.split("const PUBLIC_STATIC_RESOURCES", 1)[1].split("];", 1)[0]
for uri in sorted(set(re.findall(r'uri:\s*"([^"]+)"', resource_section))):
    entries.append({"kind":"resource","name":uri,"auth":"public","readOnly":None,"destructive":None,"openWorld":None,"outputSchema":None,"resourceUri":uri,"domain":"docs","sportClassification":"none","source":"public_registry:resource"})
for uri in sorted(uri_values.values()):
    entries.append({"kind":"resource","name":uri,"auth":"public","readOnly":None,"destructive":None,"openWorld":None,"outputSchema":None,"resourceUri":uri,"domain":"plugin_ui","sportClassification":"none","source":"plugin_ui:resource"})
entries.sort(key=lambda entry: f"{entry['kind']}:{entry['name']}")
(ROOT / "config/public-capability-snapshot.json").write_text(json.dumps({"schemaVersion":1,"entries":entries}, indent=2) + "\n")

tests = r'''import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCurrentCapabilitySnapshot,
  compareCapabilitySnapshots,
  formatSnapshotDiff,
  scanCapabilitySurfaces,
  type CapabilitySnapshot,
} from "../../scripts/public-capability-governance";

const policy = {
  schemaVersion: 1 as const,
  owner: "owner",
  scanPaths: ["server", "dist/public"],
  patterns: [
    { id: "raw", regex: "mlb_mcp__" },
    { id: "sms", regex: "sms-link|get_sms_settings" },
    { id: "alias", regex: "run_hosted_research" },
  ],
  exceptions: [],
};

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "capability-governance-"));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

describe("public capability governance", () => {
  it("builds a deterministic catalog with output schemas", () => {
    const first = buildCurrentCapabilitySnapshot();
    const second = buildCurrentCapabilitySnapshot();
    expect(first).toEqual(second);
    expect(first.entries.filter((entry) => entry.kind === "tool").every((entry) => entry.outputSchema)).toBe(true);
    expect(first.entries.some((entry) => entry.kind === "prompt")).toBe(true);
    expect(first.entries.some((entry) => entry.kind === "resource")).toBe(true);
  });

  it("detects hidden dynamic registration and raw provider aliases", () => {
    const root = fixture({ "server/hidden.ts": 'server.registerTool("mlb_mcp__hidden", {});' });
    expect(scanCapabilitySurfaces(policy, root).violations).toEqual([
      expect.objectContaining({ patternId: "raw", path: "server/hidden.ts" }),
    ]);
  });

  it("detects lazy client route chunks", () => {
    const root = fixture({ "dist/public/assets/sms-link-abc.js": 'const route="sms-link";' });
    expect(scanCapabilitySurfaces(policy, root).violations).toEqual([
      expect.objectContaining({ patternId: "sms", path: "dist/public/assets/sms-link-abc.js" }),
    ]);
  });

  it("detects renamed aliases", () => {
    const root = fixture({ "server/alias.ts": 'const hiddenAlias = "run_hosted_research";' });
    expect(scanCapabilitySurfaces(policy, root).violations).toEqual([
      expect.objectContaining({ patternId: "alias" }),
    ]);
  });

  it("reports auth downgrade and metadata artifact drift", () => {
    const baseline: CapabilitySnapshot = { schemaVersion: 1, entries: [{
      kind: "tool", name: "x", auth: "oauth", readOnly: true, destructive: false, openWorld: false,
      outputSchema: "v1", resourceUri: null, domain: "sports_data", sportClassification: "multi_sport", source: "fixture",
    }] };
    const current: CapabilitySnapshot = { schemaVersion: 1, entries: [{
      ...baseline.entries[0], auth: "public", outputSchema: "v2", destructive: true,
    }] };
    const diff = compareCapabilitySnapshots(baseline, current);
    expect(diff.authDowngrades).toEqual(["tool:x"]);
    expect(diff.changed[0].fields).toEqual(expect.arrayContaining(["auth", "outputSchema", "destructive"]));
    expect(formatSnapshotDiff(diff)).toContain("AUTH DOWNGRADES");
  });

  it("requires owned, unexpired exceptions within match budgets", () => {
    const root = fixture({ "server/legacy.ts": 'const x="mlb_mcp__old";' });
    const exceptedPolicy = {
      ...policy,
      exceptions: [{ patternIds: ["raw"], pathRegex: "^server/legacy\\.ts$", owner: "owner", expiresOn: "2026-08-31", reason: "cleanup", maxMatches: 1 }],
    };
    expect(scanCapabilitySurfaces(exceptedPolicy, root, new Date("2026-08-04T00:00:00Z")).violations).toHaveLength(0);
    expect(scanCapabilitySurfaces(exceptedPolicy, root, new Date("2026-09-01T00:00:00Z")).expiredExceptions).toHaveLength(1);
  });
});
'''
(ROOT / "server/mcp/public-capability-governance.test.ts").write_text(tests)

package_path = ROOT / "package.json"
package = json.loads(package_path.read_text())
package["scripts"]["governance:capabilities"] = "tsx scripts/public-capability-governance.ts check"
package["scripts"]["governance:capabilities:snapshot"] = "tsx scripts/public-capability-governance.ts snapshot"
package["scripts"]["governance:capabilities:update"] = "tsx scripts/public-capability-governance.ts update"
package_path.write_text(json.dumps(package, indent=2) + "\n")

(ROOT / "docs/operations").mkdir(parents=True, exist_ok=True)
(ROOT / "docs/operations/public-capability-governance.md").write_text('''# Public capability governance\n\nThe reviewed baseline is `config/public-capability-snapshot.json`. It records every public tool, prompt, and resource; authentication mode; read-only, destructive, and open-world annotations; output-schema identifier; UI resource binding; domain; and sport classification.\n\n`npm run governance:capabilities` compares the runtime catalog with the baseline and scans bounded registration, scheduler, route, navigation, and production build surfaces. It fails for additions, removals, metadata changes, OAuth-to-public downgrades, missing output schemas, raw provider prefixes, retired capabilities, expired exceptions, or exception-budget growth. There is no environment-variable bypass.\n\nIntentional changes require `npm run governance:capabilities:update`, review of the human-readable diff, and committing the baseline in the same PR. Exceptions require an owner, reason, expiration date, bounded paths, and maximum match count. Server-only legacy exceptions expire September 30, 2026; client source and client build artifacts have no exceptions.\n\nSample drift report:\n\n```text\nPublic capability snapshot diff:\n  Added: tool:get_new_surface\n  Removed: none\n  Changed: tool:get_player_detail[auth,outputSchema]\n  AUTH DOWNGRADES: tool:get_player_detail\n```\n\nRemediation: remove unintended registration or lazy route code; restore metadata; or explicitly update and review the baseline. Rollback is a single PR revert.\n''')
