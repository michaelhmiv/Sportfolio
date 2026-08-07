from __future__ import annotations

import csv
import io
import json
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ELIGIBLE = {"QB", "RB", "WR", "TE", "K"}
ALIASES = {"WAS": "WSH", "LA": "LAR", "STL": "LAR", "SD": "LAC", "OAK": "LV"}
POST_WEEK_CANDIDATES = {19: [19, 1], 20: [20, 2], 21: [21, 3], 22: [22, 5, 4]}
NFLVERSE_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv"
ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Sportfolio-NFL-History-Diagnostic/1.0", "Accept": "application/json,text/csv,*/*"})
    with urllib.request.urlopen(req, timeout=90) as response:
        return response.read()


def fetch_csv(season: int):
    text = fetch_bytes(NFLVERSE_URL.format(season=season)).decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def fetch_json(url: str):
    return json.loads(fetch_bytes(url).decode("utf-8"))


def norm_team(value):
    team = str(value or "").strip().upper()
    return ALIASES.get(team, team)


def int_or_none(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def espn_events(season: int, season_type_code: int):
    params = urllib.parse.urlencode({"dates": str(season), "seasontype": season_type_code, "limit": 1000})
    payload = fetch_json(f"{ESPN_BASE}?{params}")
    events = payload.get("events") or []
    if events:
        return events
    max_week = 18 if season_type_code == 2 else 6
    merged = {}
    for week in range(1, max_week + 1):
        params = urllib.parse.urlencode({"dates": str(season), "seasontype": season_type_code, "week": week, "limit": 100})
        for event in fetch_json(f"{ESPN_BASE}?{params}").get("events") or []:
            merged[str(event.get("id"))] = event
    return list(merged.values())


def event_shape(event, default_type):
    competitions = event.get("competitions") or []
    if not competitions:
        return None
    competition = competitions[0]
    competitors = competition.get("competitors") or []
    home = next((x for x in competitors if x.get("homeAway") == "home"), None)
    away = next((x for x in competitors if x.get("homeAway") == "away"), None)
    if not home or not away:
        return None
    home_team = norm_team((home.get("team") or {}).get("abbreviation") or (home.get("team") or {}).get("shortDisplayName"))
    away_team = norm_team((away.get("team") or {}).get("abbreviation") or (away.get("team") or {}).get("shortDisplayName"))
    season_info = event.get("season") or {}
    season_type_code = int_or_none(season_info.get("type")) or default_type
    season_type = "regular" if season_type_code == 2 else "postseason" if season_type_code == 3 else "preseason"
    week = int_or_none((event.get("week") or {}).get("number") or (competition.get("week") or {}).get("number"))
    season = int_or_none(season_info.get("year"))
    if not home_team or not away_team or not week or not season:
        return None
    return {"id": str(event.get("id")), "season": season, "season_type": season_type, "week": week, "home": home_team, "away": away_team}


def key(season, season_type, week, team, opponent):
    return f"{season}|{season_type}|{week}|{team}|{opponent}"


schedule = []
for season in (2024, 2025):
    for code in (2, 3):
        for event in espn_events(season, code):
            shaped = event_shape(event, code)
            if shaped and shaped["season"] == season:
                schedule.append(shaped)

# de-duplicate ESPN events by event id
schedule = list({game["id"]: game for game in schedule}.values())
lookup = {}
pair_weeks = defaultdict(set)
for game in schedule:
    for team, opponent in ((game["home"], game["away"]), (game["away"], game["home"])):
        lookup[key(game["season"], game["season_type"], game["week"], team, opponent)] = game
        pair_weeks[(game["season"], game["season_type"], team, opponent)].add(game["week"])

matched = 0
unmatched = 0
unmatched_by_week = Counter()
unmatched_by_pair = Counter()
unmatched_pair_exists_other_week = 0
unmatched_pair_absent = 0
examples = []
source_summary = {}

for season in (2024, 2025):
    rows = fetch_csv(season)
    candidates = 0
    season_matched = 0
    season_unmatched = 0
    for row in rows:
        position = str(row.get("position") or "").strip().upper()
        stype_raw = str(row.get("season_type") or "").strip().upper()
        if position not in ELIGIBLE or stype_raw not in {"REG", "POST"}:
            continue
        season_type = "postseason" if stype_raw == "POST" else "regular"
        week = int_or_none(row.get("week"))
        gsis = str(row.get("player_id") or "").strip()
        team = norm_team(row.get("team") or row.get("recent_team"))
        opponent = norm_team(row.get("opponent_team"))
        if not week or not gsis or not team or not opponent:
            continue
        candidates += 1
        week_candidates = POST_WEEK_CANDIDATES.get(week, [week]) if season_type == "postseason" else [week]
        game = next((lookup.get(key(season, season_type, w, team, opponent)) for w in week_candidates if lookup.get(key(season, season_type, w, team, opponent))), None)
        if game:
            matched += 1
            season_matched += 1
            continue
        unmatched += 1
        season_unmatched += 1
        bucket = f"{season}|{season_type}|{week}"
        pair = f"{season}|{season_type}|{team}|{opponent}"
        unmatched_by_week[bucket] += 1
        unmatched_by_pair[pair] += 1
        other_weeks = sorted(pair_weeks.get((season, season_type, team, opponent), set()))
        if other_weeks:
            unmatched_pair_exists_other_week += 1
        else:
            unmatched_pair_absent += 1
        if len(examples) < 80:
            examples.append({
                "season": season,
                "season_type": season_type,
                "source_week": week,
                "candidate_weeks": week_candidates,
                "team": team,
                "opponent": opponent,
                "espn_pair_weeks": other_weeks,
                "player_id": gsis,
                "player_name": str(row.get("player_display_name") or row.get("player_name") or "").strip(),
                "position": position,
            })
    source_summary[str(season)] = {"candidates": candidates, "matched": season_matched, "unmatched": season_unmatched}

schedule_counts = Counter(f"{g['season']}|{g['season_type']}" for g in schedule)
report = {
    "schedule_game_counts": dict(sorted(schedule_counts.items())),
    "source_summary": source_summary,
    "matched_total": matched,
    "unmatched_total": unmatched,
    "unmatched_pair_exists_other_week": unmatched_pair_exists_other_week,
    "unmatched_pair_absent_from_espn_schedule": unmatched_pair_absent,
    "unmatched_by_week": dict(sorted(unmatched_by_week.items())),
    "top_unmatched_pairs": dict(unmatched_by_pair.most_common(80)),
    "examples": examples,
}

out = Path("docs/NFL_HISTORY_SOURCE_DIAGNOSTIC.md")
out.write_text(
    "# NFL historical source diagnostic\n\n"
    "Generated from public nflverse weekly player-stat releases and public ESPN NFL schedules for 2024-2025. "
    "The join logic mirrors Sportfolio's current historical reconciler. No production or user data is used.\n\n"
    "```json\n" + json.dumps(report, indent=2, sort_keys=True) + "\n```\n",
    encoding="utf-8",
)
print(json.dumps(report, indent=2, sort_keys=True))
