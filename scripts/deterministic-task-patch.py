from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"expected exactly one match in {path}, found {text.count(old)}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

path = "server/jobs/sync-nflverse-stats.ts"
replace_once(path,
'''  gamesMissing: number;\n  errorCount: number;\n  errors: string[];\n''',
'''  gamesMissing: number;\n  gamesMissingByWeek: Record<string, number>;\n  gamesMissingExamples: string[];\n  errorCount: number;\n  errors: string[];\n''')
replace_once(path,
'''    gamesMissing: 0,\n    errorCount: 0,\n    errors: [],\n''',
'''    gamesMissing: 0,\n    gamesMissingByWeek: {},\n    gamesMissingExamples: [],\n    errorCount: 0,\n    errors: [],\n''')
replace_once(path,
'''            if (!game) {\n              result.gamesMissing++;\n              continue;\n            }\n''',
'''            if (!game) {\n              result.gamesMissing++;\n              const bucket = `${year}|${seasonType}|${week}`;\n              result.gamesMissingByWeek[bucket] = (result.gamesMissingByWeek[bucket] || 0) + 1;\n              if (result.gamesMissingExamples.length < 40) {\n                result.gamesMissingExamples.push(`${bucket}|${team}|${opponent}|${gsisId}`);\n              }\n              continue;\n            }\n''')
