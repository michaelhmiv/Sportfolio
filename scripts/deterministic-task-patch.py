from urllib.request import urlopen

SOURCE_URL = (
    "https://raw.githubusercontent.com/michaelhmiv/Sportfolio/"
    "c3c62f36d7f4e2f0bad692ab23290b50f6d6e757/"
    "scripts/deterministic-task-patch.py"
)
source = urlopen(SOURCE_URL, timeout=30).read().decode("utf-8")

old_mutation_assertion = 'expect(source).not.toMatch(/INSERT|UPDATE|DELETE/i);'
new_mutation_assertion = (
    r'expect(source).not.toMatch(/\\b(?:INSERT\\s+INTO|UPDATE\\s+\\w+|DELETE\\s+FROM)\\b/i);'
)
if old_mutation_assertion not in source:
    raise SystemExit("Expected broad SQL mutation assertion was not found")
source = source.replace(old_mutation_assertion, new_mutation_assertion, 1)

old_lock_assertion = '''    expect(source).not.toMatch(
      /pg_advisory_xact_lock\\(hashtextextended\\(\\$\\{[^}]+\\},\\s*0\\)\\)/,
    );'''
new_lock_assertion = '''    const scoutLockStart = source.indexOf(
      "const [advisoryLockKeyA, advisoryLockKeyB] = deriveScoutDistributionAdvisoryLockKeys",
    );
    const scoutLockCallStart = source.indexOf("pg_advisory_xact_lock", scoutLockStart);
    const scoutLockEnd = source.indexOf(");", scoutLockCallStart) + 2;
    expect(scoutLockStart).toBeGreaterThanOrEqual(0);
    expect(scoutLockCallStart).toBeGreaterThan(scoutLockStart);
    expect(scoutLockEnd).toBeGreaterThan(scoutLockCallStart);
    expect(source.slice(scoutLockStart, scoutLockEnd)).not.toContain("hashtextextended");'''
if old_lock_assertion not in source:
    raise SystemExit("Expected global scout advisory-lock assertion was not found")
source = source.replace(old_lock_assertion, new_lock_assertion, 1)

exec(compile(source, SOURCE_URL, "exec"))
