from __future__ import annotations

import csv
import io
import json
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ELIGIBLE = {"QB", "RB", "WR", "TE", "K"}
URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv"


def fetch_rows(season: int):
    req = urllib.request.Request(URL.format(season=season), headers={"User-Agent": "Sportfolio-NFL-History-Diagnostic/1.0"})
    with urllib.request.urlopen(req, timeout=60) as response:
        text = response.read().decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def norm(value):
    return str(value or "").strip()


def as_float(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def row_has_activity(row):
    # Provider production fields that indicate a player actually accumulated a game statistic.
    keys = [
        "completions", "attempts", "passing_yards", "passing_tds", "interceptions",
        "carries", "rushing_yards", "rushing_tds", "receptions", "targets",
        "receiving_yards", "receiving_tds", "sack_fumbles_lost", "rushing_fumbles_lost",
        "receiving_fumbles_lost", "special_teams_fumbles_lost", "field_goals_made",
        "field_goals_attempted", "extra_points_made", "extra_points_attempted",
    ]
    return any(abs(as_float(row.get(key))) > 0 for key in keys)


summary = {}
examples = []
blank_by_week = Counter()
blank_by_team = Counter()
blank_activity = 0
blank_no_activity = 0
missing_opponent_columns = set()

for season in (2024, 2025):
    rows = fetch_rows(season)
    if not rows:
        raise RuntimeError(f"nflverse {season} file returned no rows")

    eligible = []
    for row in rows:
        position = norm(row.get("position")).upper()
        season_type = norm(row.get("season_type")).upper()
        if position in ELIGIBLE and season_type in {"REG", "POST"}:
            eligible.append(row)

    blank = []
    for row in eligible:
        opponent = norm(row.get("opponent_team"))
        if not opponent:
            blank.append(row)
            week = norm(row.get("week")) or "?"
            stype = norm(row.get("season_type")).upper() or "?"
            team = norm(row.get("recent_team")).upper() or "?"
            blank_by_week[f"{season}:{stype}:{week}"] += 1
            blank_by_team[f"{season}:{team}"] += 1
            if row_has_activity(row):
                blank_activity += 1
            else:
                blank_no_activity += 1
            if len(examples) < 40:
                examples.append({
                    "season": season,
                    "season_type": stype,
                    "week": week,
                    "player_id": norm(row.get("player_id")),
                    "player_name": norm(row.get("player_display_name") or row.get("player_name")),
                    "position": norm(row.get("position")),
                    "recent_team": team,
                    "opponent_team": opponent,
                    "has_activity": row_has_activity(row),
                })

    opponent_field_present = "opponent_team" in rows[0]
    if not opponent_field_present:
        missing_opponent_columns.add(season)

    summary[str(season)] = {
        "all_rows": len(rows),
        "eligible_reg_post_rows": len(eligible),
        "blank_opponent_rows": len(blank),
        "nonblank_opponent_rows": len(eligible) - len(blank),
        "opponent_field_present": opponent_field_present,
    }

report = {
    "summary": summary,
    "eligible_blank_opponent_total": sum(item["blank_opponent_rows"] for item in summary.values()),
    "blank_opponent_with_activity": blank_activity,
    "blank_opponent_without_activity": blank_no_activity,
    "blank_opponent_by_week": dict(sorted(blank_by_week.items())),
    "blank_opponent_by_team": dict(sorted(blank_by_team.items())),
    "examples": examples,
}

out = Path("docs/NFL_HISTORY_SOURCE_DIAGNOSTIC.md")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(
    "# NFL historical source diagnostic\n\n"
    "Generated from the public nflverse weekly player-stat release files for 2024 and 2025. "
    "This file is diagnostic-only and contains no production or user data.\n\n"
    "```json\n" + json.dumps(report, indent=2, sort_keys=True) + "\n```\n",
    encoding="utf-8",
)

print(json.dumps(report, indent=2, sort_keys=True))
