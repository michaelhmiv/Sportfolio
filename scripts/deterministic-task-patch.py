from pathlib import Path
from urllib.request import urlopen

SOURCE_URL = (
    "https://raw.githubusercontent.com/michaelhmiv/Sportfolio/"
    "4fe6fd1f9bd800a59a1768eb50533ff439947cdf/"
    "scripts/deterministic-task-patch.py"
)
source = urlopen(SOURCE_URL, timeout=30).read().decode("utf-8")
old_runbook = '(ROOT / "docs/operations/scout-distribution-claims-repair.md").write_text(runbook)'
new_runbook = '(ROOT / "docs/operations").mkdir(parents=True, exist_ok=True)\n(ROOT / "docs/operations/scout-distribution-claims-repair.md").write_text(runbook)'
if source.count(old_runbook) != 1:
    raise RuntimeError("Unable to locate runbook write in pinned scout migration patch")
source = source.replace(old_runbook, new_runbook, 1)
old_test = '''  it("does not print database credentials", () => {
    expect(source).not.toContain("console.log(resolvedDatabaseUrl");
    expect(source).not.toContain("connectionString:", source.indexOf("console"));
  });'''
new_test = '''  it("does not include database credentials in structured log payloads", () => {
    const loggingSection = source.slice(source.indexOf("async function main()"));
    expect(loggingSection).not.toContain("resolvedDatabaseUrl");
    expect(loggingSection).not.toContain("DATABASE_URL");
    expect(loggingSection).not.toContain("connectionString");
  });'''
if source.count(old_test) != 1:
    raise RuntimeError("Unable to locate credential logging contract in pinned scout migration patch")
source = source.replace(old_test, new_test, 1)
exec(compile(source, SOURCE_URL, "exec"), {"__file__": str(Path(__file__).resolve()), "__name__": "__main__"})
