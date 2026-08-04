import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { buildPluginCatalog } from "../server/mcp/plugin/catalog";
import {
  buildPluginPresentationCatalog,
  SPORTFOLIO_UI_RESOURCE_URIS,
} from "../server/mcp/plugin/ui/surface";
import {
  buildPublicCapabilityInventory,
  buildPublicPromptRegistry,
} from "../server/mcp/public-tool-registry";

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
  changed: Array<{
    name: string;
    kind: string;
    before: SnapshotEntry;
    after: SnapshotEntry;
    fields: string[];
  }>;
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
export type ScanFinding = {
  patternId: string;
  path: string;
  line: number;
  match: string;
  excepted: boolean;
  exceptionReason?: string;
};

const ROOT = resolve(import.meta.dirname, "..");
const SNAPSHOT_PATH = resolve(ROOT, "config/public-capability-snapshot.json");
const POLICY_PATH = resolve(ROOT, "config/public-capability-governance.json");
const RETIRED_NAME =
  /^(mlb_mcp__|run_hosted_research$|review_news_impact$|get_news_digest$|get_news_unread_count$|mark_news_read$|get_sms_settings$|start_sms_link$|complete_sms_link$|update_sms_settings$|get_agent_profile$|get_agent_capabilities$|list_agent_threads$|create_agent_thread$|send_agent_message$|list_thread_messages$|list_thread_research_sources$|list_schedules$|list_schedule_templates$|upsert_schedule$|delete_schedule$)/i;

function sportClassification(domain: string, name: string): SnapshotEntry["sportClassification"] {
  const normalized = domain.toLowerCase();
  if (normalized === "sports_data" || name.includes("sports_") || name.includes("event_"))
    return "multi_sport";
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

function key(entry: SnapshotEntry) {
  return `${entry.kind}:${entry.name}`;
}
export function compareCapabilitySnapshots(
  before: CapabilitySnapshot,
  after: CapabilitySnapshot,
): SnapshotDiff {
  const oldMap = new Map(before.entries.map((entry) => [key(entry), entry]));
  const newMap = new Map(after.entries.map((entry) => [key(entry), entry]));
  const added = [...newMap].filter(([name]) => !oldMap.has(name)).map(([, value]) => value);
  const removed = [...oldMap].filter(([name]) => !newMap.has(name)).map(([, value]) => value);
  const changed: SnapshotDiff["changed"] = [];
  for (const [entryKey, oldEntry] of oldMap) {
    const next = newMap.get(entryKey);
    if (!next) continue;
    const fields = Object.keys(oldEntry).filter(
      (field) =>
        JSON.stringify(oldEntry[field as keyof SnapshotEntry]) !==
        JSON.stringify(next[field as keyof SnapshotEntry]),
    );
    if (fields.length)
      changed.push({
        name: oldEntry.name,
        kind: oldEntry.kind,
        before: oldEntry,
        after: next,
        fields,
      });
  }
  const authDowngrades = changed
    .filter((change) => change.before.auth === "oauth" && change.after.auth === "public")
    .map((change) => `${change.kind}:${change.name}`);
  const missingOutputSchemas = after.entries
    .filter((entry) => entry.kind === "tool" && !entry.outputSchema)
    .map((entry) => entry.name);
  const unsafeNames = after.entries
    .filter((entry) => RETIRED_NAME.test(entry.name))
    .map((entry) => entry.name);
  return { added, removed, changed, authDowngrades, missingOutputSchemas, unsafeNames };
}

export function formatSnapshotDiff(diff: SnapshotDiff): string {
  const lines = ["Public capability snapshot diff:"];
  lines.push(`  Added: ${diff.added.length ? diff.added.map(key).join(", ") : "none"}`);
  lines.push(`  Removed: ${diff.removed.length ? diff.removed.map(key).join(", ") : "none"}`);
  lines.push(
    `  Changed: ${diff.changed.length ? diff.changed.map((item) => `${item.kind}:${item.name}[${item.fields.join(",")}]`).join(", ") : "none"}`,
  );
  if (diff.authDowngrades.length)
    lines.push(`  AUTH DOWNGRADES: ${diff.authDowngrades.join(", ")}`);
  if (diff.missingOutputSchemas.length)
    lines.push(`  MISSING OUTPUT SCHEMAS: ${diff.missingOutputSchemas.join(", ")}`);
  if (diff.unsafeNames.length)
    lines.push(`  RETIRED/RAW CAPABILITIES: ${diff.unsafeNames.join(", ")}`);
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
    .filter(
      (exception) =>
        !exception.owner ||
        !exception.reason ||
        new Date(`${exception.expiresOn}T23:59:59.999Z`) < now,
    )
    .map(
      (exception) =>
        `${exception.owner || "unowned"}:${exception.pathRegex}:${exception.expiresOn}`,
    );
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
          if (excepted)
            exceptionCounts.set(exceptionIndex, (exceptionCounts.get(exceptionIndex) || 0) + 1);
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
  if (!existsSync(SNAPSHOT_PATH))
    throw new Error(
      "Capability baseline is missing. Run npm run governance:capabilities:update and review the diff.",
    );
  const baseline = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as CapabilitySnapshot;
  const diff = compareCapabilitySnapshots(baseline, current);
  console.log(formatSnapshotDiff(diff));
  if (
    diff.added.length ||
    diff.removed.length ||
    diff.changed.length ||
    diff.authDowngrades.length ||
    diff.missingOutputSchemas.length ||
    diff.unsafeNames.length
  ) {
    throw new Error(
      "Public capability snapshot changed. Update the reviewed baseline explicitly; environment bypasses are unsupported.",
    );
  }
  const scan = scanCapabilitySurfaces(loadPolicy());
  if (scan.expiredExceptions.length)
    throw new Error(
      `Expired or invalid capability exceptions: ${scan.expiredExceptions.join(", ")}`,
    );
  if (scan.violations.length) {
    throw new Error(
      `Retired capability surface violations:\n${scan.violations.map((finding) => `${finding.patternId} ${finding.path}:${finding.line} ${finding.match}`).join("\n")}`,
    );
  }
  console.log(
    `Capability governance passed: ${current.entries.length} entries, ${scan.findings.length} owned exception match(es), no unapproved surfaces.`,
  );
}

function main() {
  const command = process.argv[2] || "check";
  if (command === "snapshot") {
    process.stdout.write(`${JSON.stringify(buildCurrentCapabilitySnapshot(), null, 2)}\n`);
    return;
  }
  if (command === "update") {
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(buildCurrentCapabilitySnapshot(), null, 2)}\n`);
    console.log(
      `Updated ${relative(ROOT, SNAPSHOT_PATH)}. Review and commit this baseline intentionally.`,
    );
    return;
  }
  runGovernanceCheck();
}

if (process.argv[1]?.endsWith("public-capability-governance.ts")) main();
