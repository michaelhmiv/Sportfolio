from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Could not locate {label}")
    return text.replace(old, new, 1)


auth_path = Path("server/supabaseAuth.ts")
auth = auth_path.read_text()
old_bypass = 'const bypassAuth = process.env.DEV_BYPASS_AUTH !== "false";'
if auth.count(old_bypass) != 2:
    raise SystemExit("Expected exactly two default-enabled DEV_BYPASS_AUTH checks")
auth = auth.replace(old_bypass, 'const bypassAuth = process.env.DEV_BYPASS_AUTH === "true";')
auth, count = re.subn(
    r"\n    // Log migration detection for debugging\n.*?\n    // Only generate a new username",
    "\n    // Only generate a new username",
    auth,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("Could not remove verbose authentication identity logging")
auth, count = re.subn(
    r"\n    console\.log\(\n      `\[SUPABASE_AUTH\] Upserted user:.*?\n    \);",
    "",
    auth,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("Could not remove authenticated-user PII log")
auth_path.write_text(auth)

index_path = Path("server/index.ts")
index = index_path.read_text()
metrics_start = index.find("  const token = process.env.METRICS_TOKEN;")
metrics_end = index.find("\n\n  try {", metrics_start)
if metrics_start < 0 or metrics_end < 0:
    raise SystemExit("Could not locate metrics authentication block")
metrics_block = index[metrics_start:metrics_end]
if 'app.get("env") === "production" && token' not in metrics_block:
    raise SystemExit("Metrics authentication block no longer has the vulnerable shape")
secure_metrics = '''  const token = process.env.METRICS_TOKEN;
  if (app.get("env") === "production") {
    if (!token) {
      return res.status(503).json({ message: "Metrics authentication is not configured" });
    }
    const provided = _req.header("authorization")?.replace(/^Bearer\\s+/i, "") ?? "";
    if (provided !== token) return res.status(401).json({ message: "Unauthorized" });
  }'''
index = index[:metrics_start] + secure_metrics + index[metrics_end:]

capture_start = index.find("  let capturedJsonResponse:")
capture_end = index.find('  res.on("finish"', capture_start)
if capture_start < 0 or capture_end < 0:
    raise SystemExit("Could not locate API response capture block")
index = index[:capture_start] + index[capture_end:]

response_log_start = index.find("      if (capturedJsonResponse)")
response_log_end = index.find("\n\n      if (logLine.length", response_log_start)
if response_log_start < 0 or response_log_end < 0:
    raise SystemExit("Could not locate API response-body logging block")
index = index[:response_log_start] + index[response_log_end + 2 :]
index_path.write_text(index)

env_path = Path(".env.example")
env = env_path.read_text()
if "DEV_BYPASS_AUTH=" not in env:
    marker = "NODE_ENV=development\n"
    if marker not in env:
        raise SystemExit("NODE_ENV marker missing from .env.example")
    env = env.replace(
        marker,
        marker
        + "# Explicit local-only opt-in. Never enable on shared or deployed environments.\n"
        + "DEV_BYPASS_AUTH=false\n",
        1,
    )
env = env.replace(
    "# Prometheus metrics endpoint\nMETRICS_ENABLED=false\nMETRICS_TOKEN=\n",
    "# Prometheus metrics endpoint. METRICS_TOKEN is mandatory when enabled in production.\n"
    "METRICS_ENABLED=false\nMETRICS_TOKEN=\n",
    1,
)
env_path.write_text(env)

audit_path = Path(".github/workflows/security-audit.yml")
audit = audit_path.read_text().replace('node-version: "20"', 'node-version: "22"', 1)
audit = replace_once(
    audit,
    "    if: github.event_name == 'pull_request'\n",
    "    # Enable after the repository dependency graph is turned on (see issue #309).\n"
    "    if: false\n",
    "dependency-review condition",
)
audit_path.write_text(audit)

droid_path = Path(".github/workflows/droid.yml")
droid = droid_path.read_text()
droid = replace_once(
    droid,
    "    if: |\n      (github.event_name == 'issue_comment'",
    "    if: |\n      github.actor == github.repository_owner &&\n      (github.event_name == 'issue_comment'",
    "Droid trigger condition",
)
droid = replace_once(
    droid,
    "uses: Factory-AI/droid-action@main",
    "uses: Factory-AI/droid-action@4028e0ae3063a9eb5b673271e381bd645102e36f",
    "Droid action reference",
)
droid_path.write_text(droid)

review_path = Path(".github/workflows/droid-review.yml")
review = review_path.read_text()
review = replace_once(
    review,
    "    if: github.event.pull_request.draft == false\n",
    "    if: >-\n"
    "      github.event.pull_request.draft == false &&\n"
    "      github.event.pull_request.head.repo.full_name == github.repository\n",
    "Droid review condition",
)
review = replace_once(review, "      contents: write\n", "      contents: read\n", "Droid contents permission")
review = replace_once(review, "      id-token: write\n", "", "Droid OIDC permission")
review = replace_once(
    review,
    "uses: Factory-AI/droid-action@main",
    "uses: Factory-AI/droid-action@4028e0ae3063a9eb5b673271e381bd645102e36f",
    "Droid review action reference",
)
review_path.write_text(review)
