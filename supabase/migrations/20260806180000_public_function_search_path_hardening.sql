-- Fix the search path for the app-owned public functions reported by the
-- Supabase security advisor on 2026-08-06. Missing historical functions are
-- skipped so this remains safe across divergent development baselines.

BEGIN;

DO $public_function_search_path_hardening$
DECLARE
  function_signature text;
  target_function pg_catalog.regprocedure;
BEGIN
  PERFORM pg_catalog.set_config(
    'search_path',
    'pg_catalog, public, extensions',
    true
  );

  FOREACH function_signature IN ARRAY ARRAY[
    'public.add_creator_as_member()',
    'public.agent_plan_mode_touch_updated_at()',
    'public.chat_checkpoints_enforce_immutable()',
    'public.cleanup_old_agent_activity()',
    'public.cleanup_old_office_terminal_messages()',
    'public.consolidate_memories_runner_url()',
    'public.get_memory_citations(uuid)',
    'public.increment_builder_publication_views(text)',
    'public.match_codebase_files(public.vector,text,double precision,integer)',
    'public.match_memories(public.vector,uuid,double precision,integer,text)',
    'public.match_second_brain_notes(public.vector,uuid,double precision,integer)',
    'public.memory_embed_backfill_url()',
    'public.purge_old_claude_api_usage()',
    'public.record_memory_edit(uuid,text,text,text)',
    'public.research_daily_runner_url()',
    'public.scheduled_actions_touch()',
    'public.snapshot_mission_revision()',
    'public.soul_wisdom_runner_url()',
    'public.sweep_offline_agents()',
    'public.sync_org_features()',
    'public.tick_consolidate_memories()',
    'public.tick_memory_embed_backfill()',
    'public.tick_research_daily_runner(text)',
    'public.tick_soul_wisdom()',
    'public.tick_watch_scheduler()',
    'public.touch_agent_identities_updated_at()',
    'public.touch_mission_streaks_updated_at()',
    'public.update_agent_run_budgets_updated_at()',
    'public.update_mission_updated_at()',
    'public.update_parent_goal_progress()',
    'public.update_proof_validation_counts()',
    'public.update_trading_bot_configs_updated_at()',
    'public.update_trading_bot_holdings_updated_at()',
    'public.update_trading_bot_wallets_updated_at()',
    'public.validate_office_layout()',
    'public.watch_scheduler_url()'
  ]::text[]
  LOOP
    -- A baseline without pgvector cannot contain these three app functions.
    -- Guard the type lookup before parsing their exact identities.
    IF pg_catalog.strpos(function_signature, 'public.vector') > 0
      AND pg_catalog.to_regtype('public.vector') IS NULL
    THEN
      CONTINUE;
    END IF;

    target_function := pg_catalog.to_regprocedure(function_signature);
    IF target_function IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, public, extensions',
      target_function
    );
  END LOOP;
END
$public_function_search_path_hardening$;

COMMIT;
