-- CONTROLLED MANUAL MIGRATION ONLY.
-- Deploy and validate application code that no longer reads these tables before execution.
-- Take a verified database backup and capture row counts as documented in
-- docs/runbooks/retired-product-database-cleanup.md.

BEGIN;

DROP TABLE IF EXISTS "agent_skill_reviews";
DROP TABLE IF EXISTS "agent_skills";
DROP TABLE IF EXISTS "user_agent_strategy_events";
DROP TABLE IF EXISTS "user_agent_strategy_runs";
DROP TABLE IF EXISTS "user_agent_strategies";
DROP TABLE IF EXISTS "user_agent_schedules";
DROP TABLE IF EXISTS "user_agent_improvement_candidates";
DROP TABLE IF EXISTS "user_agent_message_embeddings";
DROP TABLE IF EXISTS "user_agent_memories";
DROP TABLE IF EXISTS "user_agent_messages";
DROP TABLE IF EXISTS "user_agent_action_bundles";
DROP TABLE IF EXISTS "user_agent_proposals";
DROP TABLE IF EXISTS "user_agent_runs";
DROP TABLE IF EXISTS "sms_message_events";
DROP TABLE IF EXISTS "agent_runtime_sessions";
DROP TABLE IF EXISTS "user_agent_threads";
DROP TABLE IF EXISTS "user_agent_secrets";
DROP TABLE IF EXISTS "user_agent_profiles";
DROP TABLE IF EXISTS "user_mcp_sources";
DROP TABLE IF EXISTS "agent_system_settings";
DROP TABLE IF EXISTS "user_phone_link_tokens";
DROP TABLE IF EXISTS "user_phone_links";

COMMIT;
