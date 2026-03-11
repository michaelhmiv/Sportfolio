DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'user_api_tokens',
    'user_phone_links',
    'user_phone_link_tokens',
    'sms_message_events',
    'user_agent_memories',
    'agent_runtime_sessions',
    'bot_cycle_briefs',
    'bot_run_logs',
    'user_agent_schedules',
    'user_agent_improvement_candidates',
    'agent_skills',
    'agent_skill_reviews',
    'share_payouts',
    'user_agent_profiles',
    'user_agent_proposals',
    'user_agent_secrets',
    'user_agent_threads',
    'user_agent_runs',
    'user_agent_action_bundles',
    'user_agent_messages',
    'user_agent_message_embeddings',
    'agent_system_settings',
    'reddit_post_history',
    'player_multiplier_events',
    'player_multipliers',
    'premium_activity_events'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    END IF;
  END LOOP;
END
$$;
