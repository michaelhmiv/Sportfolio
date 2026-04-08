"""
Supplemental pybaseball tool implementations
"""

from typing import Any, Dict, List, Optional

import pandas as pd
import statsapi
from pybaseball import (
    pitching_stats,
    pitching_stats_bref,
    playerid_lookup,
    playerid_reverse_lookup,
    standings,
    team_batting,
    team_fielding,
    team_pitching,
)

from mlb_stats_mcp.utils.logging_config import setup_logging

logger = setup_logging("pybaseball_supp_tools")


def _safe_int(value: Any) -> Optional[int]:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _flatten_statsapi_stat(prefix: str, stats: Dict[str, Any]) -> Dict[str, Any]:
    flattened: Dict[str, Any] = {}
    for key, value in stats.items():
        flattened[f"{prefix}{key}"] = value
    return flattened


def _resolve_mlbam_from_bbref(playerid: str) -> Optional[int]:
    lookup = playerid_reverse_lookup([playerid], key_type="bbref")
    if lookup is None or lookup.empty:
        return None
    return _safe_int(lookup.iloc[0].get("key_mlbam"))


def _build_statsapi_schedule_rows(payload: Dict[str, Any], team_id: int) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for date_entry in payload.get("dates") or []:
        for game in date_entry.get("games") or []:
            teams = game.get("teams") or {}
            home = (teams.get("home") or {}).get("team") or {}
            away = (teams.get("away") or {}).get("team") or {}
            home_id = _safe_int(home.get("id"))
            away_id = _safe_int(away.get("id"))
            is_home = home_id == team_id
            team_info = home if is_home else away
            opponent_info = away if is_home else home
            home_score = _safe_int((teams.get("home") or {}).get("score"))
            away_score = _safe_int((teams.get("away") or {}).get("score"))
            team_score = home_score if is_home else away_score
            opponent_score = away_score if is_home else home_score
            result = None
            if team_score is not None and opponent_score is not None:
                if team_score > opponent_score:
                    result = "W"
                elif team_score < opponent_score:
                    result = "L"
                else:
                    result = "T"

            rows.append(
                {
                    "season": game.get("season"),
                    "gameDate": game.get("officialDate") or game.get("gameDate"),
                    "gamePk": game.get("gamePk"),
                    "gameType": game.get("gameType"),
                    "seriesDescription": game.get("seriesDescription"),
                    "gameNumber": game.get("gameNumber"),
                    "doubleHeader": game.get("doubleHeader"),
                    "status": ((game.get("status") or {}).get("detailedState")),
                    "teamId": team_info.get("id"),
                    "teamName": team_info.get("name"),
                    "opponentId": opponent_info.get("id"),
                    "opponentName": opponent_info.get("name"),
                    "isHome": is_home,
                    "homeScore": home_score,
                    "awayScore": away_score,
                    "teamScore": team_score,
                    "opponentScore": opponent_score,
                    "result": result,
                    "venueName": ((game.get("venue") or {}).get("name")),
                    "attendance": game.get("attendance"),
                    "seriesGameNumber": game.get("seriesGameNumber"),
                    "gamesInSeries": game.get("gamesInSeries"),
                    "dayNight": game.get("dayNight"),
                    "scheduledInnings": game.get("scheduledInnings"),
                }
            )
    return rows


def _flatten_player_split_rows(split_entries: List[Dict[str, Any]], split_type: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for split in split_entries:
        label = None
        if split_type == "homeAndAway":
            label = "Home" if split.get("isHome") else "Away"
        elif split_type == "byMonth":
            label = split.get("month")
        elif split_type == "byDayOfWeek":
            label = split.get("dayOfWeek")
        elif split_type == "winLoss":
            label = "Win" if split.get("isWin") else "Loss"
        elif split_type == "lastXGames":
            label = split.get("numGames") or split.get("numLeagues") or "Recent"

        row = {
            "splitType": split_type,
            "splitLabel": label,
            "season": split.get("season"),
            "teamId": ((split.get("team") or {}).get("id")),
            "teamName": ((split.get("team") or {}).get("name")),
            "leagueId": ((split.get("league") or {}).get("id")),
            "leagueName": ((split.get("league") or {}).get("name")),
        }
        row.update(_flatten_statsapi_stat("stat_", split.get("stat") or {}))
        rows.append(row)
    return rows


def _normalize_lookup_names(last: str, first: Optional[str]) -> tuple[str, Optional[str]]:
    normalized_last = (last or "").strip()
    normalized_first = (first or "").strip() or None

    if not normalized_first and " " in normalized_last:
        parts = normalized_last.split()
        normalized_last = parts[-1]
        normalized_first = " ".join(parts[:-1]) or None

    return normalized_last, normalized_first


def _fast_statsapi_player_lookup(last: str, first: Optional[str]) -> pd.DataFrame:
    query = " ".join(part for part in [first, last] if part).strip()
    if not query:
        return pd.DataFrame()

    matches = statsapi.lookup_player(query)
    if not matches:
        return pd.DataFrame()

    rows = []
    for match in matches:
        debut = str(match.get("mlbDebutDate") or "").strip()
        rows.append(
            {
                "name_last": (match.get("lastName") or "").lower() or None,
                "name_first": (match.get("firstName") or "").lower() or None,
                "key_mlbam": match.get("id"),
                "key_retro": None,
                "key_bbref": None,
                "key_fangraphs": None,
                "mlb_played_first": int(debut[:4]) if len(debut) >= 4 and debut[:4].isdigit() else None,
                "mlb_played_last": None,
            }
        )

    df = pd.DataFrame(rows)
    if df.empty:
        return df

    if first:
        exact_mask = (
            df["name_first"].fillna("").str.lower().eq(first.lower())
            & df["name_last"].fillna("").str.lower().eq(last.lower())
        )
        if exact_mask.any():
            return df.loc[exact_mask].reset_index(drop=True)

    return df.reset_index(drop=True)


def _convert_dataframe_to_dict(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Convert a pandas DataFrame to a dictionary for JSON serialization.

    Args:
        df: The pandas DataFrame to convert

    Returns:
        Dictionary representation of the DataFrame
    """

    if df is None or df.empty:
        return {"data": [], "count": 0}

    try:
        df_clean = df.copy()
        df_clean = df_clean.where(pd.notnull(df_clean), None)
        df_clean = df_clean.replace("", None)
        records = df_clean.to_dict(orient="records")
        return {"data": records, "count": len(records), "columns": df.columns.tolist()}

    except Exception as e:
        logger.error(f"Error in DF processing - {e}")
        return {
            "data": [],
            "count": 0,
            "error": f"DataFrame serialization failed: {e!s}",
        }


def _normalize_prospect_player_type(player_type: Optional[str]) -> Optional[str]:
    normalized = (player_type or "").strip().lower()
    if normalized in {"pitcher", "pitchers"}:
        return "pitchers"
    if normalized in {"batter", "batters", "hitter", "hitters"}:
        return "batters"
    return None


def _matches_prospect_player_type(pick: Dict[str, Any], player_type: Optional[str]) -> bool:
    normalized = _normalize_prospect_player_type(player_type)
    if not normalized:
        return True

    abbreviation = (
        str(
            ((pick.get("person") or {}).get("primaryPosition") or {}).get("abbreviation") or ""
        )
        .strip()
        .upper()
    )
    if not abbreviation:
        return True

    pitcher_codes = {"P", "SP", "RP", "LHP", "RHP"}
    return abbreviation in pitcher_codes if normalized == "pitchers" else abbreviation not in pitcher_codes


def _resolve_team_id(team: Optional[str]) -> Optional[int]:
    normalized = (team or "").strip()
    if not normalized:
        return None

    payload = statsapi.get("teams", {"sportId": 1, "activeStatus": "Y"})
    teams = payload.get("teams") if isinstance(payload, dict) else []
    lowered = normalized.lower()
    exact_match_fields = [
        "abbreviation",
        "teamCode",
        "fileCode",
        "teamName",
        "clubName",
        "name",
        "shortName",
        "locationName",
        "franchiseName",
    ]

    for team_entry in teams or []:
        for field in exact_match_fields:
            candidate = str(team_entry.get(field) or "").strip().lower()
            if candidate and candidate == lowered:
                return _safe_int(team_entry.get("id"))

    matches = statsapi.lookup_team(normalized)
    if not matches:
        raise Exception(f"Could not resolve team '{team}' to an MLB team ID")

    team_id = matches[0].get("id")
    return int(team_id) if team_id is not None else None


def _extract_draft_picks(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    drafts = payload.get("drafts") or {}
    rounds = drafts.get("rounds") if isinstance(drafts, dict) else []
    picks: List[Dict[str, Any]] = []
    for round_entry in rounds or []:
        if not isinstance(round_entry, dict):
            continue
        for pick in round_entry.get("picks") or []:
            if isinstance(pick, dict):
                picks.append(pick)
    return picks


async def get_pitching_stats_bref(season: Optional[int] = None) -> Dict[str, Any]:
    """
    Get pitching stats from Baseball Reference for a given season.

    Args:
        season: The season to get data for. If None, pulls data for current year.

    Returns:
        Dictionary containing pitching stats from Baseball Reference

    Raises:
        Exception: If there's an error retrieving pitching stats
    """
    resolved_season = season or int(pd.Timestamp.utcnow().year)
    try:
        logger.debug(f"Retrieving Baseball Reference pitching stats for season: {resolved_season}")

        df = pitching_stats_bref(resolved_season)

        if len(df) == 0:
            raise Exception("No pitching stats data found")

        logger.debug(f"Retrieved {len(df)} pitching stats records from Baseball Reference")

        return _convert_dataframe_to_dict(df)
    except Exception as e:
        logger.warning(
            "Baseball Reference pitching stats failed for season %s, falling back to FanGraphs: %s",
            resolved_season,
            e,
        )
        try:
            fallback_df = pitching_stats(
                start_season=resolved_season,
                end_season=resolved_season,
                league="ALL",
                qual=None,
                ind=1,
            )
            if len(fallback_df) == 0:
                raise Exception("No fallback pitching stats data found")
            result = _convert_dataframe_to_dict(fallback_df)
            result["warning"] = (
                "Baseball Reference data was unavailable. Returned FanGraphs fallback data instead."
            )
            result["source"] = "fangraphs_fallback"
            return result
        except Exception as fallback_error:
            error_msg = f"Error retrieving pitching stats from Baseball Reference: {e!s}"
            logger.error("%s | Fallback failed: %s", error_msg, fallback_error)
            raise Exception(error_msg) from e


async def get_pitching_stats_range(
    start_dt: str,
    end_dt: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Get pitching stats from Baseball Reference for a date range.

    Args:
        start_dt: Beginning of date range (YYYY-MM-DD)
        end_dt: End of date range (YYYY-MM-DD). If None, returns data for start_dt only.

    Returns:
        Dictionary containing pitching stats for the date range

    Raises:
        Exception: If there's an error retrieving pitching stats
    """
    try:
        logger.debug(f"Retrieving pitching stats range from {start_dt} to {end_dt or start_dt}")

        payload = statsapi.get(
            "stats",
            {
                "stats": "byDateRange",
                "group": "pitching",
                "sportIds": 1,
                "startDate": start_dt,
                "endDate": end_dt or start_dt,
                "limit": 1000,
            },
        )
        stat_groups = payload.get("stats") if isinstance(payload, dict) else []
        splits = stat_groups[0].get("splits") if stat_groups else []

        if not splits:
            raise Exception("No pitching stats data found for date range")

        rows: List[Dict[str, Any]] = []
        for split in splits:
            player = split.get("player") or {}
            team = split.get("team") or {}
            position = split.get("position") or {}
            league = split.get("league") or {}
            row = {
                "season": split.get("season"),
                "rank": split.get("rank"),
                "playerId": player.get("id"),
                "playerName": player.get("fullName"),
                "teamId": team.get("id"),
                "teamName": team.get("name"),
                "position": position.get("abbreviation"),
                "leagueId": league.get("id"),
                "leagueName": league.get("name"),
            }
            row.update(_flatten_statsapi_stat("stat_", split.get("stat") or {}))
            rows.append(row)

        df = pd.DataFrame(rows)
        logger.debug(f"Retrieved {len(df)} pitching stats records for date range via Stats API")

        result = _convert_dataframe_to_dict(df)
        result["source"] = "statsapi_byDateRange"
        return result
    except Exception as e:
        error_msg = f"Error retrieving pitching stats range: {e!s}"
        logger.error(error_msg)
        raise Exception(error_msg) from e


async def get_pitching_stats(
    start_season: int,
    end_season: Optional[int] = None,
    league: str = "all",
    qual: Optional[int] = None,
    ind: int = 1,
) -> Dict[str, Any]:
    """
    Get season-level pitching data from FanGraphs.

    Args:
        start_season: First season to retrieve data from
        end_season: Final season to retrieve data from.
        If None, returns only start_season.
        league: Either "all", "nl", "al", or "mnl"
        qual: Minimum number of plate appearances to be included
        ind: 1 for individual season level, 0 for aggregate data

    Returns:
        Dictionary containing pitching stats from FanGraphs

    Raises:
        Exception: If there's an error retrieving pitching stats
    """
    try:
        logger.debug(
            f"Retrieving FanGraphs pitching stats for seasons {start_season} to "
            f"{end_season or start_season}, league: {league}, qual: {qual}, ind: {ind}"
        )

        df = pitching_stats(
            start_season=start_season,
            end_season=end_season or start_season,
            league=league.upper(),
            qual=qual,
            ind=ind,
        )

        if len(df) == 0:
            raise Exception("No pitching stats data found")

        logger.debug(f"Retrieved {len(df)} pitching stats records from FanGraphs")

        return _convert_dataframe_to_dict(df)
    except Exception as e:
        error_msg = f"Error retrieving pitching stats from FanGraphs: {e!s}"
        logger.error(error_msg)
        raise Exception(error_msg) from e


async def get_playerid_lookup(
    last: str,
    first: Optional[str] = None,
    fuzzy: bool = False,
) -> Dict[str, Any]:
    """
    Look up a player's IDs by name.

    Args:
        last: Player's last name (case insensitive)
        first: Player's first name (case insensitive)
        fuzzy: Search for inexact name matches

    Returns:
        Dictionary containing player ID data

    Raises:
        Exception: If there's an error looking up player
    """
    try:
        last, first = _normalize_lookup_names(last, first)
        logger.debug(f"Looking up player: {last}, {first}, fuzzy: {fuzzy}")

        df = _fast_statsapi_player_lookup(last, first)
        if df.empty:
            df = playerid_lookup(last, first, fuzzy=fuzzy)

        if len(df) == 0 and first:
            df = playerid_lookup(first, last, fuzzy=fuzzy)

        logger.debug(f"Completed lookup df: {df}")
        if len(df) == 0:
            raise Exception(f"No player found matching {first} {last}")

        logger.debug(f"Found {len(df)} players matching search criteria")

        return _convert_dataframe_to_dict(df)
    except Exception as e:
        error_msg = f"Error looking up player {first} {last}: {e!s}"
        logger.error(error_msg)
        raise Exception(error_msg) from e


async def reverse_lookup_player(
    player_ids: List[int],
    key_type: str = "mlbam",
) -> Dict[str, Any]:
    """
    Find player names and IDs given a list of player IDs.

    Args:
        player_ids: List of player IDs
        key_type: Type of ID ('mlbam', 'retro', 'bbref', 'fangraphs')

    Returns:
        Dictionary containing player names and cross-referenced IDs

    Raises:
        Exception: If there's an error in reverse lookup
    """
    try:
        logger.debug(f"Reverse looking up {len(player_ids)} players with key_type: {key_type}")

        df = playerid_reverse_lookup(player_ids, key_type)

        if len(df) == 0:
            raise Exception("No players found for provided IDs")

        logger.debug(f"Found {len(df)} players in reverse lookup")

        return _convert_dataframe_to_dict(df)
    except Exception as e:
        error_msg = f"Error in reverse player lookup: {e!s}"
        logger.error(error_msg)
        raise Exception(error_msg) from e


async def get_schedule_and_record(season: int, team: str) -> Dict[str, Any]:
    """
    Get a team's game-level results for a given season.

    Args:
        season: The season for which you want team record data
        team: Team abbreviation (e.g. "PHI", "BOS", "LAD")

    Returns:
        Dictionary containing team's schedule and record data

    Raises:
        Exception: If there's an error retrieving schedule data
    """
    try:
        logger.debug(f"Retrieving schedule and record for {team} in {season}")

        team_id = _resolve_team_id(team)
        if team_id is None:
            raise Exception(f"Could not resolve team id for {team}")

        payload = statsapi.get(
            "schedule",
            {
                "sportId": 1,
                "teamId": team_id,
                "season": season,
                "gameTypes": "R",
            },
        )
        rows = _build_statsapi_schedule_rows(payload, team_id)

        if not rows:
            raise Exception(f"No schedule data found for {team} in {season}")

        df = pd.DataFrame(rows)
        logger.debug(f"Retrieved {len(df)} regular-season games for {team} in {season}")

        result = _convert_dataframe_to_dict(df)
        result["source"] = "statsapi_schedule"
        return result
    except Exception as e:
        error_msg = f"Error retrieving schedule for {team} in {season}: {e!s}"
        logger.error(error_msg)
        raise Exception(error_msg) from e


async def get_player_splits(
    playerid: str,
    year: Optional[int] = None,
    player_info: bool = False,
    pitching_splits: bool = False,
) -> Dict[str, Any]:
    """
    Look up a player's split stats from baseball-reference.

    Args:
        playerid: Player's bbref playerid (e.g. 'troutmi01')
        year: Year to get split stats for. If None, returns career splits.
        player_info: If True, returns both splits and player info
        pitching_splits: If True, returns pitching splits; otherwise batting splits

    Returns:
        Dictionary containing split stats data

    Raises:
        Exception: If there's an error retrieving split stats
    """
    try:
        logger.debug(
            f"Retrieving splits for player {playerid}, year: {year}, "
            f"pitching: {pitching_splits}, info: {player_info}"
        )
        mlbam_id = _resolve_mlbam_from_bbref(playerid)
        if mlbam_id is None:
            raise Exception(f"Could not resolve MLBAM id for bbref player id {playerid}")

        stat_group = "pitching" if pitching_splits else "hitting"
        resolved_year = year or int(pd.Timestamp.utcnow().year)
        split_types = ["homeAndAway", "byMonth", "byDayOfWeek", "winLoss", "lastXGames"]
        hydrate = (
            f"stats(group=[{stat_group}],type=[{','.join(split_types)}],season={resolved_year})"
        )
        people_payload = statsapi.get("people", {"personIds": mlbam_id, "hydrate": hydrate})
        people = people_payload.get("people") if isinstance(people_payload, dict) else []
        if not people:
            raise Exception(f"No player data found for bbref player id {playerid}")

        player_entry = people[0]
        stats_entries = player_entry.get("stats") or []

        rows: List[Dict[str, Any]] = []
        for entry in stats_entries:
            split_type = ((entry.get("type") or {}).get("displayName") or "").strip()
            splits = entry.get("splits") or []
            if not split_type or not splits:
                continue
            rows.extend(_flatten_player_split_rows(splits, split_type))

        if not rows:
            raise Exception(
                f"No split data available from the MLB Stats API for {playerid} in {resolved_year}"
            )

        df = pd.DataFrame(rows)
        splits_data = _convert_dataframe_to_dict(df)
        splits_data["source"] = "statsapi_split_types"
        splits_data["player_info"] = {
            "id": player_entry.get("id"),
            "fullName": player_entry.get("fullName"),
            "firstName": player_entry.get("firstName"),
            "lastName": player_entry.get("lastName"),
            "primaryPosition": ((player_entry.get("primaryPosition") or {}).get("abbreviation")),
            "batSide": ((player_entry.get("batSide") or {}).get("code")),
            "pitchHand": ((player_entry.get("pitchHand") or {}).get("code")),
            "height": player_entry.get("height"),
            "weight": player_entry.get("weight"),
            "active": player_entry.get("active"),
            "currentTeam": ((player_entry.get("currentTeam") or {}).get("name")),
            "mlbamId": mlbam_id,
            "bbrefId": playerid,
            "season": resolved_year,
            "group": stat_group,
        }
        if not player_info:
            splits_data.pop("player_info", None)
        return splits_data

    except Exception as e:
        error_msg = f"Error retrieving splits for player {playerid}: {e!s}"
        logger.error(error_msg)
        raise Exception(error_msg) from e


async def get_standings(season: Optional[int] = None) -> Dict[str, Any]:
    """
    Get division standings for a given season.

    Args:
        season: Season to get standings for. Defaults to current year if None.

    Returns:
        Dictionary containing division standings

    Raises:
        Exception: If there's an error retrieving standings
    """
    try:
        logger.debug(f"Retrieving standings for season: {season}")

        tables = standings(season)

        divisions = [
            "AL East",
            "AL Central",
            "AL West",
            "NL East",
            "NL Central",
            "NL West",
        ]

        # Convert each table and combine results
        all_data = {}
        for i, table in enumerate(tables):
            table_dict = _convert_dataframe_to_dict(table)
            all_data[divisions[i]] = table_dict
        return {"data": all_data, "divisions": divisions}
    except Exception as e:
        error_msg = f"Error retrieving standings for season {season}: {e!s}"
        logger.error(error_msg)
        raise Exception(error_msg) from e


async def get_team_batting(
    start_season: int,
    end_season: Optional[int] = None,
    league: str = "all",
    ind: int = 1,
) -> Dict[str, Any]:
    """
    Get team-level batting stats.

    Args:
        start_season: First season for team batting data
        end_season: Last season for team batting data.
        If None, returns only start_season.
        league: Either "all", "nl", "al", or "mnl"
        ind: 1 for individual season level, 0 for aggregate data

    Returns:
        Dictionary containing team batting stats

    Raises:
        Exception: If there's an error retrieving team batting stats
    """
    try:
        logger.debug(
            f"Retrieving team batting stats for seasons {start_season} to "
            f"{end_season or start_season}, league: {league}, ind: {ind}"
        )

        df = team_batting(start_season, end_season, league, ind)

        if len(df) == 0:
            raise Exception("No team batting data found")

        logger.debug(f"Retrieved {len(df)} team batting records")

        return _convert_dataframe_to_dict(df)
    except Exception as e:
        error_msg = f"Error retrieving team batting stats: {e!s}"
        logger.error(error_msg)
        raise Exception(error_msg) from e


async def get_team_fielding(
    start_season: int,
    end_season: Optional[int] = None,
    league: str = "all",
    ind: int = 1,
) -> Dict[str, Any]:
    """
    Get team-level fielding stats.

    Args:
        start_season: First season for team fielding data
        end_season: Last season for team fielding data.
        If None, returns only start_season.
        league: Either "all", "nl", "al", or "mnl"
        ind: 1 for individual season level, 0 for aggregate data

    Returns:
        Dictionary containing team fielding stats

    Raises:
        Exception: If there's an error retrieving team fielding stats
    """
    try:
        logger.debug(
            f"Retrieving team fielding stats for seasons {start_season} to "
            f"{end_season or start_season}, league: {league}, ind: {ind}"
        )

        df = team_fielding(start_season, end_season, league, ind)

        if len(df) == 0:
            raise Exception("No team fielding data found")

        logger.debug(f"Retrieved {len(df)} team fielding records")

        return _convert_dataframe_to_dict(df)
    except Exception as e:
        error_msg = f"Error retrieving team fielding stats: {e!s}"
        logger.error(error_msg)
        raise Exception(error_msg) from e


async def get_team_pitching(
    start_season: int,
    end_season: Optional[int] = None,
    league: str = "all",
    ind: int = 1,
) -> Dict[str, Any]:
    """
    Get team-level pitching stats.

    Args:
        start_season: First season for team pitching data
        end_season: Last season for team pitching data.
        If None, returns only start_season.
        league: Either "all", "nl", "al", or "mnl"
        ind: 1 for individual season level, 0 for aggregate data

    Returns:
        Dictionary containing team pitching stats

    Raises:
        Exception: If there's an error retrieving team pitching stats
    """
    try:
        logger.debug(
            f"Retrieving team pitching stats for seasons {start_season} to "
            f"{end_season or start_season}, league: {league}, ind: {ind}"
        )

        df = team_pitching(start_season, end_season, league, ind)

        if len(df) == 0:
            raise Exception("No team pitching data found")

        logger.debug(f"Retrieved {len(df)} team pitching records")

        return _convert_dataframe_to_dict(df)
    except Exception as e:
        error_msg = f"Error retrieving team pitching stats: {e!s}"
        logger.error(error_msg)
        raise Exception(error_msg) from e


async def get_top_prospects(
    team: Optional[str] = None,
    player_type: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Get top prospects by team or leaguewide.

    Args:
        team: Team name (no whitespace). If None, returns leaguewide prospects.
        player_type: Either "pitchers" or "batters". If None, returns both.

    Returns:
        Dictionary containing top prospects data

    Raises:
        Exception: If there's an error retrieving prospects data
    """
    try:
        logger.debug(f"Retrieving top prospects for team: {team}, type: {player_type}")
        team_id = _resolve_team_id(team)
        current_year = pd.Timestamp.utcnow().year
        rows: List[Dict[str, Any]] = []

        for season in range(current_year, current_year - 4, -1):
            params: Dict[str, Any] = {"year": season, "limit": 50}
            if team_id is not None:
                params["teamId"] = team_id

            payload = statsapi.get("draft", params)
            picks = _extract_draft_picks(payload)
            filtered_picks = [
                pick
                for pick in picks
                if _matches_prospect_player_type(pick, player_type)
            ]

            if not filtered_picks:
                continue

            for pick in filtered_picks:
                person = pick.get("person") or {}
                team_info = pick.get("team") or {}
                position = (person.get("primaryPosition") or {}).get("abbreviation")
                school = (pick.get("school") or {}).get("name")
                rows.append(
                    {
                        "year": pick.get("year") or season,
                        "rank": pick.get("rank"),
                        "pickNumber": pick.get("pickNumber"),
                        "displayPickNumber": pick.get("displayPickNumber"),
                        "fullName": person.get("fullName"),
                        "position": position,
                        "team": team_info.get("name"),
                        "school": school,
                        "playerId": person.get("id"),
                        "batSide": (person.get("batSide") or {}).get("code"),
                        "pitchHand": (person.get("pitchHand") or {}).get("code"),
                    }
                )

            if rows:
                break

        if len(rows) == 0:
            raise Exception("No prospects data found")

        df = pd.DataFrame(rows)
        logger.debug(f"Retrieved {len(df)} prospects records via MLB Stats API")

        return _convert_dataframe_to_dict(df)
    except Exception as e:
        error_msg = f"Error retrieving prospects data: {e!s}"
        logger.error(error_msg)
        raise Exception(error_msg) from e
