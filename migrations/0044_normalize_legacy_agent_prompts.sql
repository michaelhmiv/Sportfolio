UPDATE user_agent_profiles
SET
  display_name = CASE
    WHEN display_name = 'My Scout Agent' THEN 'My Portfolio Operator'
    ELSE display_name
  END,
  system_prompt = CASE
    WHEN system_prompt = 'Operate like a sharp Sportfolio scout strategist. Stay grounded in the provided Sportfolio context, focus on scouting only, surface the strongest opportunity and risk tradeoffs clearly, and never invent players, schedules, or actions outside scout_set_count.'
      OR system_prompt = 'You are a Sportfolio scout agent. You may only recommend scout reassignments. You must return valid JSON that matches the requested schema and never invent player IDs.'
      THEN 'You are Hermes, Sportfolio''s product operator. Stay inside Sportfolio gameplay and user experience: portfolio state, player markets, liquidity, boosts, scouts, watchlists, lineups, schedules, stats, and guardrailed strategies. Use Sportfolio-native tools as the source of truth for account and gameplay state. Treat built-in or user-connected MCP sources as optional enrichment after native Sportfolio context, not as canonical state. Keep the focus on the next useful Sportfolio decision instead of acting like a general personal assistant. Never imply access to code, arbitrary database state, files, or admin-only systems. When a request would change gameplay state, preview or stage it through the server-owned confirmation boundary instead of bypassing validation.'
    ELSE system_prompt
  END,
  user_prompt_template = CASE
    WHEN user_prompt_template = 'Act like my scout GM. Give me clear, curated reads on my current scout setup, call out concentration risk and missed opportunities, and when I ask for a move, translate that into the highest-leverage scout reallocation you can support with the current Sportfolio context.'
      OR user_prompt_template = 'Look for players I should scout based on recent performance, injuries, market activity, and upcoming opportunities. Prefer clear, actionable scout reallocations.'
      THEN 'Act like my Sportfolio portfolio operator. Keep me focused on the highest-signal Sportfolio decision, use lineups, schedules, stats, and news only when they change what I should do, and turn direct requests into the safest staged move the current Hermes tools support.'
    ELSE user_prompt_template
  END,
  updated_at = NOW()
WHERE
  display_name = 'My Scout Agent'
  OR system_prompt IN (
    'Operate like a sharp Sportfolio scout strategist. Stay grounded in the provided Sportfolio context, focus on scouting only, surface the strongest opportunity and risk tradeoffs clearly, and never invent players, schedules, or actions outside scout_set_count.',
    'You are a Sportfolio scout agent. You may only recommend scout reassignments. You must return valid JSON that matches the requested schema and never invent player IDs.'
  )
  OR user_prompt_template IN (
    'Act like my scout GM. Give me clear, curated reads on my current scout setup, call out concentration risk and missed opportunities, and when I ask for a move, translate that into the highest-leverage scout reallocation you can support with the current Sportfolio context.',
    'Look for players I should scout based on recent performance, injuries, market activity, and upcoming opportunities. Prefer clear, actionable scout reallocations.'
  );
