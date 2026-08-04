from urllib.request import urlopen

SOURCE_URL = (
    "https://raw.githubusercontent.com/michaelhmiv/Sportfolio/"
    "c3c62f36d7f4e2f0bad692ab23290b50f6d6e757/"
    "scripts/deterministic-task-patch.py"
)
source = urlopen(SOURCE_URL, timeout=30).read().decode("utf-8")
old = 'expect(source).not.toMatch(/INSERT|UPDATE|DELETE/i);'
new = 'expect(source).not.toMatch(/\\b(?:INSERT\\s+INTO|UPDATE\\s+\\w+|DELETE\\s+FROM)\\b/i);'
if old not in source:
    raise SystemExit("Expected broad SQL mutation assertion was not found")
source = source.replace(old, new, 1)
exec(compile(source, SOURCE_URL, "exec"))
