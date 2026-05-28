#!/usr/bin/env node

import "dotenv/config";
import { Pool } from "pg";

function getFlag(name) {
  return process.argv.includes(name);
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const dbUrl =
  getArg("--db-url") || process.env.DATABASE_URL || process.env.DEV_DATABASE_URL || null;
const lookbackDays = toInt(getArg("--lookback-days"), 7);
const asJson = getFlag("--json");

if (!dbUrl) {
  console.error(
    "[android-push-audit] Missing database URL. Pass --db-url or set DATABASE_URL/DEV_DATABASE_URL.",
  );
  process.exit(1);
}

const queries = [
  {
    id: "token_store_summary",
    sql: `
      with token_stats as (
        select
          count(*) as total_rows,
          count(*) filter (where is_active) as active_rows,
          count(*) filter (where not is_active) as inactive_rows,
          count(distinct user_id) as users,
          count(distinct token) as tokens,
          count(distinct device_id) filter (where device_id is not null) as devices,
          max(last_registered_at) as latest_registered_at,
          max(last_successful_at) as latest_success_at,
          max(last_failure_at) as latest_failure_at
        from user_push_tokens
        where platform = 'android'
      ),
      device_stats as (
        select
          count(*) as total_rows,
          count(*) filter (where enabled and invalidated_at is null) as active_rows,
          count(*) filter (where not enabled or invalidated_at is not null) as inactive_rows,
          count(distinct user_id) as users,
          count(distinct token) as tokens,
          count(distinct device_id) filter (where device_id is not null) as devices,
          max(last_seen_at) as latest_registered_at,
          null::timestamp as latest_success_at,
          null::timestamp as latest_failure_at
        from user_push_devices
        where platform = 'android'
      )
      select 'user_push_tokens' as source, * from token_stats
      union all
      select 'user_push_devices' as source, * from device_stats
    `,
  },
  {
    id: "token_overlap_summary",
    sql: `
      with tokens as (
        select token, user_id
        from user_push_tokens
        where platform = 'android'
      ),
      devices as (
        select token, user_id
        from user_push_devices
        where platform = 'android'
      )
      select
        (select count(*) from tokens) as token_rows,
        (select count(*) from devices) as device_rows,
        (select count(*) from tokens t join devices d using (token)) as overlap_rows,
        (select count(*) from tokens t join devices d using (token) where t.user_id = d.user_id) as overlap_same_user,
        (select count(*) from tokens t join devices d using (token) where t.user_id <> d.user_id) as overlap_different_user,
        (select count(*) from tokens t left join devices d using (token) where d.token is null) as only_in_user_push_tokens,
        (select count(*) from devices d left join tokens t using (token) where t.token is null) as only_in_user_push_devices
    `,
  },
  {
    id: "per_user_active_count_drift",
    sql: `
      with token_users as (
        select user_id, count(*) filter (where is_active) as active_tokens
        from user_push_tokens
        where platform = 'android'
        group by user_id
      ),
      device_users as (
        select user_id, count(*) filter (where enabled and invalidated_at is null) as active_devices
        from user_push_devices
        where platform = 'android'
        group by user_id
      )
      select
        coalesce(t.user_id, d.user_id) as user_id,
        coalesce(t.active_tokens, 0) as active_tokens,
        coalesce(d.active_devices, 0) as active_devices,
        coalesce(t.active_tokens, 0) - coalesce(d.active_devices, 0) as delta
      from token_users t
      full join device_users d on d.user_id = t.user_id
      where coalesce(t.active_tokens, 0) <> coalesce(d.active_devices, 0)
      order by abs(coalesce(t.active_tokens, 0) - coalesce(d.active_devices, 0)) desc
      limit 50
    `,
  },
  {
    id: "token_invalidation_reasons",
    sql: `
      select
        source,
        reason,
        count(*) as count
      from (
        select
          'user_push_tokens'::text as source,
          coalesce(last_error, '(none)') as reason
        from user_push_tokens
        where platform = 'android' and not is_active
        union all
        select
          'user_push_devices'::text as source,
          coalesce(invalid_reason, '(none)') as reason
        from user_push_devices
        where platform = 'android' and (not enabled or invalidated_at is not null)
      ) reasons
      group by source, reason
      order by count desc
      limit 100
    `,
  },
  {
    id: "notification_event_status_summary",
    sql: `
      select
        delivery_status,
        count(*) as count
      from push_notification_events
      where created_at >= now() - ($1::text || ' days')::interval
      group by delivery_status
      order by count desc
    `,
    params: [String(lookbackDays)],
  },
  {
    id: "notification_event_status_by_type",
    sql: `
      select
        notification_type,
        delivery_status,
        count(*) as count
      from push_notification_events
      where created_at >= now() - ($1::text || ' days')::interval
      group by notification_type, delivery_status
      order by notification_type asc, count desc
    `,
    params: [String(lookbackDays)],
  },
  {
    id: "recent_provider_unavailable",
    sql: `
      select
        notification_type,
        count(*) as count,
        max(created_at) as latest_at
      from push_notification_events
      where delivery_status = 'provider_unavailable'
        and created_at >= now() - ($1::text || ' days')::interval
      group by notification_type
      order by count desc
    `,
    params: [String(lookbackDays)],
  },
  {
    id: "recent_failed_events_with_errors",
    sql: `
      select
        notification_type,
        delivery_status,
        metadata -> 'delivery' ->> 'failureCount' as failure_count,
        created_at
      from push_notification_events
      where delivery_status in ('failed', 'partial')
        and created_at >= now() - ($1::text || ' days')::interval
      order by created_at desc
      limit 200
    `,
    params: [String(lookbackDays)],
  },
];

const pool = new Pool({
  connectionString: dbUrl,
  max: 2,
});

const output = {
  generatedAt: new Date().toISOString(),
  lookbackDays,
  sections: {},
};

try {
  const client = await pool.connect();
  try {
    await client.query("begin read only");

    const nowResult = await client.query("select now() as db_now");
    output.dbNow = nowResult.rows[0]?.db_now ?? null;

    for (const query of queries) {
      const result = await client.query(query.sql, query.params || []);
      output.sections[query.id] = result.rows;
    }

    await client.query("rollback");
  } finally {
    client.release();
  }
} catch (error) {
  console.error(
    "[android-push-audit] Query failed:",
    error instanceof Error ? error.message : error,
  );
  await pool.end();
  process.exit(1);
}

await pool.end();

if (asJson) {
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

console.log(`Android Push Audit Report (${output.generatedAt})`);
console.log(`Database now: ${output.dbNow}`);
console.log(`Lookback days: ${lookbackDays}`);

for (const [section, rows] of Object.entries(output.sections)) {
  console.log(`\n=== ${section} ===`);
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log("(no rows)");
    continue;
  }
  console.table(rows);
}
